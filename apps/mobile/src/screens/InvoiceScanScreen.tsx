import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  uploadInvoice,
  describeUploadError,
  type ExtractedVehicle,
  type InvoiceFile,
} from '../api/documents';

/**
 * Phase 3.3 — photograph an invoice and have its line items read.
 *
 * ── Why this compiles before the camera exists ──────────────────────────────
 *
 * It never imports `expo-image-picker`. The image arrives through a `pickImage`
 * prop, exactly as `GarageScreen` takes `onOpenVehicle` rather than importing
 * react-navigation.
 *
 * That is not only a style rule here, it is a scheduling constraint. The
 * development client currently on the simulator was built **before** the picker
 * was a dependency, so importing it anywhere in the module graph crashes the
 * app on launch — the working setup would be gone before its replacement
 * exists. With the picker injected, this screen can be written, routed and
 * looked at today, and wiring the real picker after build `29b4d76f` installs
 * is a few lines in the navigator.
 *
 * ── The outcomes, and why two of them are not errors ────────────────────────
 *
 * `uploadInvoice` returns a discriminated result rather than throwing for the
 * two answers the server actually reached:
 *
 *   - **vehicle-mismatch** — the invoice reads as a different car. The owner is
 *     the one who knows, so this offers to send it again with the heuristic
 *     overridden. It is a question, not a failure, and it is phrased as one.
 *   - **not-an-invoice** — the photograph is not an automotive invoice.
 *
 * Both arrive as HTTP 200. A screen written against exceptions alone would show
 * "uploaded" for both, which is the defect `documents.ts` is shaped to prevent
 * and the reason that shape is worth the extra type.
 *
 * ── What is kept when something goes wrong ──────────────────────────────────
 *
 * The chosen file. Every failure path leaves `file` set, so "Try again" resends
 * what was already picked rather than reopening the camera — the same rule as
 * the advisor's composer, where losing what someone produced is worse than any
 * error message. Re-photographing a bill you are standing next to is a small
 * cost; re-photographing one you have already thrown away is not.
 */

type State =
  | { status: 'idle' }
  | { status: 'working'; note: string }
  | { status: 'done'; itemsExtracted: number }
  | {
      status: 'mismatch';
      message: string;
      extracted: ExtractedVehicle | null;
      expected: ExtractedVehicle | null;
    }
  | { status: 'not-invoice'; message: string }
  | { status: 'error'; message: string };

function describeVehicle(vehicle: ExtractedVehicle | null): string {
  if (!vehicle) return 'an unrecognised vehicle';
  const parts = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'an unrecognised vehicle';
}

export function InvoiceScanScreen({
  vehicleId,
  pickImage,
  onSignOut,
  onFiled,
}: {
  vehicleId: string;
  /**
   * Resolves to the chosen image, or `null` if the picker was dismissed.
   *
   * Injected so this file stays free of native imports — see the header. The
   * real implementation lands with `expo-image-picker` once the build that
   * contains it is installed.
   */
  pickImage: () => Promise<InvoiceFile | null>;
  onSignOut: () => void;
  /** Lets the caller refresh the vehicle once line items have changed. */
  onFiled?: () => void;
}) {
  const [state, setState] = useState<State>({ status: 'idle' });
  const [file, setFile] = useState<InvoiceFile | null>(null);

  const send = useCallback(
    async (chosen: InvoiceFile, confirmVehicle: boolean) => {
      setState({
        status: 'working',
        // Two different waits, and the second is the long one — the model is
        // reading the document. Saying so is the difference between "slow" and
        // "stuck".
        note: confirmVehicle ? 'Filing it against this car…' : 'Reading the invoice…',
      });

      try {
        const result = await uploadInvoice({ vehicleId, file: chosen, confirmVehicle });

        if (result.status === 'vehicle-mismatch') {
          setState({
            status: 'mismatch',
            message: result.message,
            extracted: result.extracted,
            expected: result.expected,
          });
          return;
        }

        if (result.status === 'not-an-invoice') {
          setState({ status: 'not-invoice', message: result.message });
          return;
        }

        setState({ status: 'done', itemsExtracted: result.itemsExtracted });
        onFiled?.();
      } catch (caught) {
        const message = describeUploadError(caught);
        setState({ status: 'error', message });

        // 401 is the one failure a retry cannot fix. `App.tsx` swaps to sign-in
        // the moment the session clears, so this reports it and lets that
        // happen rather than offering a button that cannot work.
        if ((caught as { status?: number })?.status === 401) onSignOut();
      }
    },
    [vehicleId, onSignOut, onFiled]
  );

  const choose = useCallback(async () => {
    setState({ status: 'working', note: 'Opening the camera…' });

    try {
      const chosen = await pickImage();
      if (!chosen) {
        // Dismissing the picker is not a failure and must not read as one.
        setState({ status: 'idle' });
        return;
      }
      setFile(chosen);
      await send(chosen, false);
    } catch (caught) {
      setState({ status: 'error', message: describeUploadError(caught) });
    }
  }, [pickImage, send]);

  return (
    <ScrollView contentContainerStyle={styles.body}>
      {state.status === 'idle' && (
        <View style={styles.block}>
          <Text style={styles.title}>Scan an invoice</Text>
          <Text style={styles.body_}>
            Photograph a service invoice and its line items are read and added to this car's
            history. A PDF works too.
          </Text>
          <Pressable style={styles.primary} onPress={() => void choose()}>
            <Text style={styles.primaryText}>Take a photo</Text>
          </Pressable>
        </View>
      )}

      {state.status === 'working' && (
        <View style={styles.centred}>
          <ActivityIndicator color="rgba(255,255,255,0.5)" />
          <Text style={styles.note}>{state.note}</Text>
        </View>
      )}

      {state.status === 'done' && (
        <View style={styles.block}>
          <Text style={styles.title}>Filed</Text>
          <Text style={styles.body_}>
            {state.itemsExtracted > 0
              ? `${state.itemsExtracted} line ${state.itemsExtracted === 1 ? 'item' : 'items'} added to this car's history.`
              : /*
                  Zero is honest and not a failure — the document is stored, its
                  lines just could not be itemised. Claiming a number here would
                  be the overclaim the provenance work removed elsewhere.
                */
                'The invoice is stored. No line items could be read from it.'}
          </Text>
          <Pressable style={styles.secondary} onPress={() => setState({ status: 'idle' })}>
            <Text style={styles.secondaryText}>Scan another</Text>
          </Pressable>
        </View>
      )}

      {state.status === 'mismatch' && (
        <View style={styles.block}>
          <Text style={styles.title}>Is this the right car?</Text>
          <Text style={styles.body_}>
            This invoice looks like it is for {describeVehicle(state.extracted)}, but you are adding
            it to {describeVehicle(state.expected)}.
          </Text>
          {/*
            The owner decides. The extractor is a heuristic and is wrong often
            enough that refusing outright would be worse than asking — but
            filing silently would be worse still, because a service record on
            the wrong car corrupts the history the advisor reasons from.
          */}
          <Pressable
            style={styles.primary}
            onPress={() => file && void send(file, true)}
            disabled={!file}
          >
            <Text style={styles.primaryText}>Yes, file it here</Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={() => setState({ status: 'idle' })}>
            <Text style={styles.secondaryText}>No, cancel</Text>
          </Pressable>
        </View>
      )}

      {state.status === 'not-invoice' && (
        <View style={styles.block}>
          <Text style={styles.title}>That does not look like an invoice</Text>
          <Text style={styles.body_}>{state.message}</Text>
          <Pressable style={styles.primary} onPress={() => void choose()}>
            <Text style={styles.primaryText}>Try another photo</Text>
          </Pressable>
        </View>
      )}

      {state.status === 'error' && (
        <View style={styles.block}>
          <Text style={styles.title}>That did not upload</Text>
          <Text style={styles.body_}>{state.message}</Text>
          {/*
            Resends the file already chosen rather than reopening the camera.
            See the header: the photograph may be of a bill that is no longer
            in front of the person holding the phone.
          */}
          <Pressable
            style={styles.primary}
            onPress={() => (file ? void send(file, false) : void choose())}
          >
            <Text style={styles.primaryText}>{file ? 'Try again' : 'Take a photo'}</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, gap: 14, flexGrow: 1 },
  block: { gap: 12 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  /* `body_` because `body` is the container above. */
  body_: { color: 'rgba(255,255,255,0.5)', fontSize: 15, lineHeight: 22 },

  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  note: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },

  primary: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryText: { color: '#080808', fontSize: 16, fontWeight: '600' },

  secondary: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  secondaryText: { color: '#fff', fontSize: 15 },
});
