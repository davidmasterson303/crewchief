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
 * ── What replaces this body ─────────────────────────────────────────────────
 *
 * Roughly:
 *
 *   const permission = await ImagePicker.requestCameraPermissionsAsync();
 *   if (!permission.granted) throw new ImagePickerUnavailable('…');
 *   const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
 *   if (result.canceled) return null;
 *   const asset = result.assets[0];
 *   return { uri: asset.uri, name: …, type: asset.mimeType ?? 'image/jpeg', size: asset.fileSize };
 *
 * Two things that must survive the swap, because they are decisions rather than
 * plumbing:
 *
 *   - **`null` means dismissed, and dismissed is not an error.** The screen
 *     returns to idle silently. Only a genuine failure throws.
 *   - **Quality is reduced at capture.** `MAX_FILE_SIZE` is 10 MB and a
 *     full-resolution iPhone photograph approaches it, but the real reason is
 *     the M235i photo: a 2.3 MB original that has never once decoded on this
 *     simulator. Sending a smaller image is the fix that was not available for
 *     that one.
 */

/** Thrown when the camera cannot be reached at all — refused, or not yet built in. */
export class ImagePickerUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImagePickerUnavailable';
  }
}

/**
 * Resolves to the chosen image, or `null` if the picker was dismissed.
 *
 * **Not implemented until the build lands**, and it throws a message written to
 * be read rather than returning `null` — a silent no-op would look like a
 * dismissal and make a missing capability indistinguishable from a cancelled
 * one. That distinction is the same one this whole flow is built around.
 */
export async function pickInvoiceImage(): Promise<InvoiceFile | null> {
  throw new ImagePickerUnavailable(
    'Camera support arrives with the next app build. Nothing was lost.'
  );
}
