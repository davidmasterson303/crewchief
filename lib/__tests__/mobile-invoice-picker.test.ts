/**
 * The picker must hand back something the upload will actually accept.
 *
 * @jest-environment node
 *
 * **The defect this pins failed for a real tester on 5 Aug**, on the first
 * genuine end-to-end run of the invoice flow:
 *
 *   > "That did not upload — That file type cannot be read. Use a photo or a
 *   > PDF."
 *
 * The chain broke before the vision model, inside the client's own validation.
 * `iPhones shoot HEIC by default`, and `expo-image-picker` re-encodes most
 * formats but passes HEIC straight through — its own iOS source is explicit:
 *
 *     case UTType.heic.identifier:
 *       return (rawData, ".heic")        // ImageUtils.swift:145
 *
 * The mime type is derived from that extension, so `image/heic` arrived at a
 * check whose allowlist is jpeg/png/webp/pdf, and the upload was refused before
 * a byte left the phone.
 *
 * **It was never a simulator quirk.** Every stock simulator photo is HEIC
 * because every real iPhone photo is. It would have failed for the first person
 * to photograph an invoice.
 *
 * The fix is `preferredAssetRepresentationMode: Compatible`, which asks
 * PHPicker for the most compatible representation — the system transcodes HEIC
 * to JPEG on the device, needing no extra native module and therefore no second
 * cloud build. This file exists so removing that one option fails here rather
 * than in someone's hands.
 */

/* Module, not a global script — see the note in `mobile-session.test.ts`. */
export {};

const requestCameraPermissionsAsync = jest.fn();
const requestMediaLibraryPermissionsAsync = jest.fn();
const launchCameraAsync = jest.fn();
const launchImageLibraryAsync = jest.fn();

jest.mock(
  'expo-image-picker',
  () => ({
    UIImagePickerPreferredAssetRepresentationMode: {
      Automatic: 'automatic',
      Compatible: 'compatible',
      Current: 'current',
    },
    requestCameraPermissionsAsync: () => requestCameraPermissionsAsync(),
    requestMediaLibraryPermissionsAsync: () => requestMediaLibraryPermissionsAsync(),
    launchCameraAsync: (options: unknown) => launchCameraAsync(options),
    launchImageLibraryAsync: (options: unknown) => launchImageLibraryAsync(options),
  }),
  { virtual: true }
);

/* eslint-disable @typescript-eslint/no-var-requires */
const {
  pickInvoiceImage,
  ImagePickerUnavailable,
} = require('../../apps/mobile/src/media/pick-image');
const { ALLOWED_DOCUMENT_TYPES } = require('@crewchief/core/validation');
/* eslint-enable @typescript-eslint/no-var-requires */

const GRANTED = { granted: true, canAskAgain: true };

beforeEach(() => {
  jest.clearAllMocks();
  requestCameraPermissionsAsync.mockResolvedValue(GRANTED);
  requestMediaLibraryPermissionsAsync.mockResolvedValue(GRANTED);
});

function picked(asset: Record<string, unknown>) {
  return { canceled: false, assets: [asset] };
}

describe('the HEIC defect', () => {
  it('asks the system for a compatible representation', () => {
    // The whole fix, in one assertion. Without this the picker returns the
    // asset's own format, and on an iPhone that is HEIC.
    launchImageLibraryAsync.mockResolvedValue(picked({ uri: 'file:///a.jpg' }));

    return pickInvoiceImage('library').then(() => {
      expect(launchImageLibraryAsync).toHaveBeenCalledWith(
        expect.objectContaining({ preferredAssetRepresentationMode: 'compatible' })
      );
    });
  });

  it('asks for it on the camera path too', async () => {
    launchCameraAsync.mockResolvedValue(picked({ uri: 'file:///a.jpg' }));
    await pickInvoiceImage('camera');

    expect(launchCameraAsync).toHaveBeenCalledWith(
      expect.objectContaining({ preferredAssetRepresentationMode: 'compatible' })
    );
  });

  it('produces a type the upload will accept', async () => {
    // The end the user actually cares about: whatever comes back must survive
    // `uploadInvoice`'s allowlist, which is what rejected the real attempt.
    launchImageLibraryAsync.mockResolvedValue(
      picked({ uri: 'file:///a.jpg', mimeType: 'image/jpeg', fileName: 'a.jpg' })
    );

    const file = await pickInvoiceImage('library');
    expect(ALLOWED_DOCUMENT_TYPES).toContain(file.type);
  });

  it('defaults to an accepted type when the picker reports none', async () => {
    // A camera capture often has no mimeType. Defaulting to something outside
    // the allowlist would recreate the same failure by a different route.
    launchImageLibraryAsync.mockResolvedValue(picked({ uri: 'file:///a.jpg' }));

    const file = await pickInvoiceImage('library');
    expect(ALLOWED_DOCUMENT_TYPES).toContain(file.type);
  });
});

describe('what the picker returns', () => {
  it('carries uri, name, type and size through', async () => {
    launchImageLibraryAsync.mockResolvedValue(
      picked({
        uri: 'file:///invoice.jpg',
        fileName: 'invoice.jpg',
        mimeType: 'image/jpeg',
        fileSize: 145832,
      })
    );

    await expect(pickInvoiceImage('library')).resolves.toEqual({
      uri: 'file:///invoice.jpg',
      name: 'invoice.jpg',
      type: 'image/jpeg',
      size: 145832,
    });
  });

  it('generates a filename WITH an extension when there is none', async () => {
    // A camera capture has no filename. The extension is what tells the server
    // the type — an untyped blob is the upload that fails after the model has
    // already been paid for.
    launchCameraAsync.mockResolvedValue(picked({ uri: 'file:///tmp/x', mimeType: 'image/jpeg' }));

    const file = await pickInvoiceImage('camera');
    expect(file.name).toMatch(/\.jpg$/);
  });

  it('treats dismissal as null, not as a failure', async () => {
    // The distinction the whole flow is built around: a picker that was closed
    // is not a picker that failed, and the screen returns to idle silently.
    launchImageLibraryAsync.mockResolvedValue({ canceled: true });
    await expect(pickInvoiceImage('library')).resolves.toBeNull();
  });

  it('throws rather than returning null when nothing usable came back', async () => {
    // Not cancelled, but no asset. Returning null here would read as a
    // dismissal and hide a real failure.
    launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [] });
    await expect(pickInvoiceImage('library')).rejects.toBeInstanceOf(ImagePickerUnavailable);
  });
});

describe('refused permission', () => {
  it('offers a retry when the answer can still change', async () => {
    requestCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });

    await expect(pickInvoiceImage('camera')).rejects.toThrow(/needs the camera/i);
    expect(launchCameraAsync).not.toHaveBeenCalled();
  });

  it('points at Settings only when it is genuinely the only route', async () => {
    /*
      The two refusals need different sentences. Sending someone to Settings
      when they simply tapped the wrong button is the more annoying mistake,
      and it is the one a single generic message makes every time.
    */
    requestCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    await expect(pickInvoiceImage('camera')).rejects.toThrow(/Settings/);
  });

  it('mentions the library alternative when the camera is permanently off', async () => {
    // There is a second way to complete the task; a dead end that does not say
    // so is a dead end.
    requestCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    await expect(pickInvoiceImage('camera')).rejects.toThrow(/library/i);
  });
});
