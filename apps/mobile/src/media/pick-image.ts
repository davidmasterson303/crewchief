import * as ImagePicker from 'expo-image-picker';

import type { InvoiceFile } from '../api/documents';

/**
 * The one place that will import `expo-image-picker`.
 *
 * ⚠ **Two callers now, and that is why this is `pick-image` rather than
 * `pick-invoice-image`.** Invoices came first; vehicle photographs arrived on
 * 15 Aug. Adding a second module that imported the picker would have broken the
 * invariant this file exists to hold — see below — so the seam widened instead
 * of multiplying.
 *
 * ── Why it is a seam and not just an import ─────────────────────────────────
 *
 * `expo-image-picker` is a **native** module. The development client currently
 * installed on the simulator was built before it was a dependency, so importing
 * it anywhere in the module graph crashes the app on launch — the working setup
 * would be gone before its replacement exists. Build `29b4d76f` (5 Aug) is what
 * contains it.
 *
 * Keeping the import behind one small module means exactly one file changes
 * when that build installs, and `InvoiceScanScreen` never has to know a native
 * module exists. It takes `pickImage` as a prop for the same reason
 * `GarageScreen` takes `onOpenVehicle`.
 *
 * Wired 5 Aug once build `29b4d76f` installed — verified by reading
 * `ExpoImagePicker` out of the installed bundle's dylib before importing it,
 * because importing a module the binary lacks crashes the app on launch.
 *
 * ── Two decisions, not plumbing ─────────────────────────────────────────────
 *
 *   - **`null` means dismissed, and dismissed is not an error.** The screen
 *     returns to idle silently. Only a genuine failure throws.
 *   - **Quality is reduced at capture.** `MAX_FILE_SIZE` is 10 MB and a
 *     full-resolution iPhone photograph approaches it, but the real reason is
 *     the M235i photo: a 2.3 MB original that has never once decoded on this
 *     simulator. Sending a smaller image is the fix that was not available for
 *     that one, and the extractor reads text — it does not need 12 megapixels.
 *
 * ── Why the library is a first-class source and not a fallback ──────────────
 *
 * `cc-product-0001`'s pitch is photographing a receipt in the shop's car park,
 * so the camera leads. But a great many invoices arrive as an emailed PDF or a
 * photo taken days ago, and **the simulator has no camera at all** — so a
 * camera-only flow could never be exercised on the machine this is developed
 * on. Both sources return the same `InvoiceFile`, so the screen does not care
 * which was used.
 */

/** Thrown when the camera cannot be reached at all — refused, or not yet built in. */
export class ImagePickerUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImagePickerUnavailable';
  }
}

/** Where the image comes from. Both produce the same `InvoiceFile`. */
export type InvoiceImageSource = 'camera' | 'library';

/**
 * Reduce the capture before it is encoded.
 *
 * 0.7 rather than 1.0. The extractor reads text off an invoice, which survives
 * JPEG compression easily, and the alternative is uploading several megabytes
 * over cellular from a car park. See the M235i note above for what an
 * unreduced original does on this simulator.
 */
const QUALITY = 0.7;

/**
 * The wording each caller needs when permission is refused.
 *
 * Split out because "Well Kept needs the camera to photograph an invoice" is
 * wrong when someone is adding a picture of their car, and a generic sentence
 * covering both would tell nobody what they were doing.
 */
const PROMPTS = {
  invoice: {
    camera: 'Well Kept needs the camera to photograph an invoice.',
    library: 'Well Kept needs access to your photos to attach an invoice.',
  },
  vehicle: {
    camera: 'Well Kept needs the camera to photograph your car.',
    library: 'Well Kept needs access to your photos to add a picture of your car.',
  },
} as const;

export type ImagePurpose = keyof typeof PROMPTS;

/**
 * Resolves to the chosen image, or `null` if the picker was dismissed.
 *
 * Throws `ImagePickerUnavailable` only when the source genuinely cannot be
 * reached — permission refused, or no camera on the device. **Dismissal is not
 * a failure** and must stay distinguishable from one: the screen returns to
 * idle silently for `null` and shows an error for a throw.
 */
export async function pickInvoiceImage(
  source: InvoiceImageSource = 'camera',
): Promise<InvoiceFile | null> {
  return pickImage(source, 'invoice', QUALITY);
}

/**
 * A photograph of the car itself.
 *
 * ── Why the quality is lower than the invoice's ─────────────────────────────
 *
 * ⚠ **A vehicle photo has a hard server-side ceiling that an invoice does not.**
 * `MAX_STORED_PHOTO_BYTES` is 1.5 MB, and it exists because this account still
 * holds a 3000×4000 / 2.3 MB original that has never decoded on a device — the
 * plate's timeout exists solely to escape it. `MAX_FILE_SIZE` for a document is
 * 10 MB, so an invoice has room this does not.
 *
 * On web the browser downscales before upload. **The phone cannot**: there is
 * no canvas, and `expo-image-manipulator` — the module that would cap a
 * dimension properly — is not in this build and adding it is a native change
 * costing one of the month's cloud builds.
 *
 * So the lever available today is the encoder's quality, and 0.45 is it. A
 * 12-megapixel capture lands under the ceiling at that setting in the ordinary
 * case, and the ceiling is not raised to meet it: raising it would reintroduce
 * exactly the undecodable-original bug for the next car.
 *
 * ⚠ **This is a probability, not a guarantee**, and the flow is built to say so
 * — the server returns its refusal reason and the screen shows it, rather than
 * failing generically. A guaranteed dimension cap needs that native module.
 */
export async function pickVehiclePhoto(
  source: InvoiceImageSource = 'library',
): Promise<InvoiceFile | null> {
  return pickImage(source, 'vehicle', VEHICLE_QUALITY, 'vehicle');
}

/**
 * Reduce a vehicle capture further than an invoice. See `pickVehiclePhoto`.
 */
const VEHICLE_QUALITY = 0.45;

async function pickImage(
  source: InvoiceImageSource,
  purpose: ImagePurpose,
  quality: number,
  namePrefix = 'invoice',
): Promise<InvoiceFile | null> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      /*
        `canAskAgain` distinguishes the two refusals, and they need different
        sentences: a first "no" can be retried by tapping again, while a
        permanent one can only be undone in Settings. Telling someone to visit
        Settings when they simply tapped the wrong button is the more annoying
        of the two mistakes.
      */
      throw new ImagePickerUnavailable(
        permission.canAskAgain
          ? PROMPTS[purpose].camera
          : 'Camera access is off for Well Kept. You can turn it on in Settings, or choose a photo from your library instead.',
      );
    }
  } else {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw new ImagePickerUnavailable(
        permission.canAskAgain
          ? PROMPTS[purpose].library
          : 'Photo access is off for Well Kept. You can turn it on in Settings.',
      );
    }
  }

  const options: ImagePicker.ImagePickerOptions = {
    // Array form: `MediaTypeOptions` is deprecated in this version.
    mediaTypes: ['images'],
    quality,
    /*
      ── This line is the fix for the 5 Aug end-to-end failure ────────────────

      **iPhones shoot HEIC by default**, and PHPicker hands back whatever the
      asset already is. `expo-image-picker`'s own iOS source re-encodes most
      formats but passes HEIC through untouched:

          case UTType.heic.identifier:
            return (rawData, ".heic")          // ImageUtils.swift:145

      The mime type is derived from that extension, so the client received
      `image/heic`, which is not in `ALLOWED_DOCUMENT_TYPES` — and the upload
      was refused before it left the phone with "That file type cannot be read".

      That was never a simulator quirk. Every stock simulator photo is HEIC
      because every real iPhone photo is, so it would have failed for the first
      person to photograph an invoice.

      `Compatible` asks PHPicker for the most compatible representation, which
      on iOS transcodes HEIC to JPEG before handing it over — done by the
      system, on the device, needing no extra native module and therefore **no
      second cloud build**. The registered type identifier becomes
      `public.jpeg`, the switch above falls to its `default:` branch, and the
      file arrives as `.jpg`.

      Widening the allowlist to accept HEIC was the alternative and was
      rejected: Gemini does accept HEIC, so it would have worked, but it would
      store an Apple-only container browsers cannot render — moving the problem
      into the web document library rather than solving it.
    */
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  };

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

  if (result.canceled) return null;

  const asset = result.assets?.[0];
  if (!asset?.uri) {
    // Not cancelled, but nothing usable came back. Returning null here would
    // read as a dismissal and hide a real failure.
    throw new ImagePickerUnavailable('That image could not be read. Try again.');
  }

  return {
    uri: asset.uri,
    /*
      A camera capture has no filename. The server stores what it is given and
      the extension is what tells it the type, so a generated name must carry
      one — an untyped blob is the upload that fails after the model has
      already been paid for.
    */
    name: asset.fileName ?? `${namePrefix}-${Date.now()}.jpg`,
    type: asset.mimeType ?? 'image/jpeg',
    // Optional on purpose: absent means "unknown", and `uploadInvoice` lets an
    // unknown size through rather than refusing on absence.
    size: asset.fileSize,
  };
}
