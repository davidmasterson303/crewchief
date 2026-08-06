import * as ImagePicker from 'expo-image-picker';

import type { InvoiceFile } from '../api/documents';

/**
 * The one place that will import `expo-image-picker`.
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
 * Resolves to the chosen image, or `null` if the picker was dismissed.
 *
 * Throws `ImagePickerUnavailable` only when the source genuinely cannot be
 * reached — permission refused, or no camera on the device. **Dismissal is not
 * a failure** and must stay distinguishable from one: the screen returns to
 * idle silently for `null` and shows an error for a throw.
 */
export async function pickInvoiceImage(
  source: InvoiceImageSource = 'camera'
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
          ? 'CrewChief needs the camera to photograph an invoice.'
          : 'Camera access is off for CrewChief. You can turn it on in Settings, or choose a photo from your library instead.'
      );
    }
  } else {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw new ImagePickerUnavailable(
        permission.canAskAgain
          ? 'CrewChief needs access to your photos to attach an invoice.'
          : 'Photo access is off for CrewChief. You can turn it on in Settings.'
      );
    }
  }

  const options: ImagePicker.ImagePickerOptions = {
    // Array form: `MediaTypeOptions` is deprecated in this version.
    mediaTypes: ['images'],
    quality: QUALITY,
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
    name: asset.fileName ?? `invoice-${Date.now()}.jpg`,
    type: asset.mimeType ?? 'image/jpeg',
    // Optional on purpose: absent means "unknown", and `uploadInvoice` lets an
    // unknown size through rather than refusing on absence.
    size: asset.fileSize,
  };
}
