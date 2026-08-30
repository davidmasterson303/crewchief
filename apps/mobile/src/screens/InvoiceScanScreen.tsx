import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  uploadInvoice,
  describeUploadError,
  diagnoseUploadError,
  type ExtractedVehicle,
  type InvoiceFile,
} from '../api/documents';
import Button from '../components/Button';
import { ApiRequestError } from '../api/client';
import { OPTICAL_CENTRE, PAGE_BODY, border, radius, space, surface, text, type } from '../theme';
import AiConsentSheet from '../components/AiConsentSheet';
import { INVOICE_AI_CONSENT } from '@wellkept/core/ai-consent-copy';
import { readAiConsent, recordAiConsent, type AiConsent } from '../onboarding/ai-consent';
import { interFace } from '../theme/fonts';

/**
 * Phase 3.3 — photograph an invoice and have its line items read.
 *
 * ── Why the image is injected rather than imported ──────────────────────────
 *
 * This file never imports `expo-image-picker`. The image arrives through a
 * `pickImage` prop, exactly as `GarageScreen` takes `onOpenVehicle` rather than
 * importing react-navigation.
 *
 * That began as a scheduling constraint and is now a design one. The dev client
 * was built before the picker was a dependency, so importing it anywhere in the
 * module graph would have crashed the app on launch — the screen was therefore
 * written, routed and rendered *before* build `29b4d76f` existed, and wiring the
 * real picker afterwards touched one file. The reason to keep the seam is what
 * it bought: this screen is an ordinary component that can be rendered with a
 * stub, which is the only reason it was ever looked at before the camera
 * existed.
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
  /*
    `retryable` is the fix for the 5 Aug dead end. A client-side rejection —
    wrong type, too large — fails identically no matter how many times the same
    file is resent, so offering "Try again" there stranded the user on an error
    screen with no way back to the picker. Only a failure that *might* pass on a
    second attempt gets a retry.
  */
  | {
      status: 'error';
      message: string;
      retryable: boolean;
      signInMayHelp?: boolean;
      /** `__DEV__` only — kind, origin, status, elapsed ms, and the raw cause. */
      diagnostic?: string;
    };

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
   * Injected so this file stays free of native imports — see the header.
   * `src/media/pick-image.ts` is the real implementation and the only
   * module that imports `expo-image-picker`.
   */
  pickImage: (source: 'camera' | 'library') => Promise<InvoiceFile | null>;
  onSignOut: () => void;
  /** Lets the caller refresh the vehicle once line items have changed. */
  onFiled?: () => void;
}) {
  const [state, setState] = useState<State>({ status: 'idle' });

  /**
   * Whether this person has agreed their invoice may go to Google — LEG-02.
   *
   * ⚠ **Guideline 5.1.2(i), amended November 2025**, requires explicit
   * permission before personal data reaches a third-party AI. This screen
   * photographs a document carrying a shop's name and business address —
   * sometimes a VIN — sends it to Gemini, and said nothing about Google at all.
   *
   * `unknown` until the read resolves, so the sheet does not flash for somebody
   * who already answered. The source they chose is held alongside, so accepting
   * continues into the thing they were trying to do rather than dropping them
   * back on the idle screen to press it again.
   */
  /*
    ⚠ `null` is **"still reading"**, which is not the same as `'unknown'`
    ("asked nobody yet"). `readAiConsent` is async, so for the first frames the
    screen does not know the answer — and treating that as "not answered" fired
    the sheet at somebody who had already agreed, and on the advisor's
    deep-link path consumed the one-shot ref before consent had resolved,
    leaving the question unasked forever.
  */
  const [consent, setConsent] = useState<AiConsent | null>(null);
  const [awaitingConsent, setAwaitingConsent] = useState<'camera' | 'library' | null>(null);

  useEffect(() => {
    let live = true;
    void readAiConsent().then((answer) => {
      if (live) setConsent(answer);
    });

    return () => {
      live = false;
    };
  }, []);
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
        /*
          Reached only from `uploadInvoice`'s network and server paths — a
          timeout, a 500, a rate limit — all of which can succeed on a second
          attempt with the same file.
        */
        setState({
          status: 'error',
          message,
          retryable: true,
          // Instructing someone to sign in without giving them a way to is the
          // defect this pairs with — see the button below.
          signInMayHelp: caught instanceof ApiRequestError && caught.status === 401,
          // Unconditional. Gating this on the error *type* is what left the
          // one unanticipated branch with nothing to report.
          diagnostic: diagnoseUploadError(caught),
        });

        /*
          **No longer signs the user out on any 401.** It used to, and that was
          wrong twice over: a *server* 401 may be a token the server would
          accept a second later, so clearing the session destroys a working one
          over a single response — and when `signOut()` itself then failed, the
          app sat on an error saying "sign in again" while every other screen
          stayed happily authenticated. That is exactly what a real tester hit
          on 5 Aug, three times out of three.

          Only a device-side 401 — this client knowing it holds no session — is
          acted on automatically, because there is nothing to preserve. Anything
          else offers the button below and lets the person decide.
        */
        if (caught instanceof ApiRequestError && caught.isLocallySignedOut) onSignOut();
      }
    },
    [vehicleId, onSignOut, onFiled]
  );

  /**
   * Open the picker and run the upload. **No consent check** — see `choose`.
   *
   * ⚠ Split out on purpose. `choose` closes over `consent`, so calling it from
   * the sheet's accept handler runs the closure that opened the sheet — where
   * consent is still `unknown` — and re-opens it. Separating the gate from the
   * work means accepting continues into the thing the person was doing, which
   * is the difference between a question and an obstacle.
   */
  const openPicker = useCallback(async (source: 'camera' | 'library') => {
    setState({
      status: 'working',
      note: source === 'camera' ? 'Opening the camera…' : 'Opening your photos…',
    });

    try {
      const chosen = await pickImage(source);
      if (!chosen) {
        // Dismissing the picker is not a failure and must not read as one.
        setState({ status: 'idle' });
        return;
      }
      setFile(chosen);
      await send(chosen, false);
    } catch (caught) {
      /*
        A refused permission or a rejected file type. Resending changes
        nothing, so this offers a different file rather than a doomed retry.
      */
      setState({
        status: 'error',
        message: describeUploadError(caught),
        retryable: false,
        diagnostic: diagnoseUploadError(caught),
      });
    }
  }, [pickImage, send]);

  /**
   * The consent gate in front of `openPicker` — LEG-02.
   *
   * ⚠ **Asked before the picker opens, not after.** Consent obtained once the
   * photograph exists is consent for something that has already happened, and
   * by then the person has aimed a camera at a document carrying a shop's name
   * and address on the strength of a screen that told them nothing about
   * Google.
   *
   * `declined` is not blocked here: the idle screen stands its controls down in
   * that state, so reaching this while declined means somebody deliberately
   * re-opened the sheet.
   */
  const choose = useCallback(
    async (source: 'camera' | 'library') => {
      if (consent === 'unknown') {
        setAwaitingConsent(source);
        return;
      }

      await openPicker(source);
    },
    [consent, openPicker]
  );

  return (
    <>
    <AiConsentSheet
      visible={awaitingConsent !== null}
      copy={INVOICE_AI_CONSENT}
      onAccept={() => {
        const source = awaitingConsent;
        setAwaitingConsent(null);
        setConsent('granted');
        void recordAiConsent('granted');
        /*
          Continue into the thing they were trying to do. Dropping them back on
          the idle screen to press the same button again is how a consent sheet
          reads as an obstacle rather than a question.
        */
        /*
          `openPicker`, not `choose` — the gate has just been satisfied and
          re-checking it here would read the state this render still holds.
        */
        if (source) void openPicker(source);
      }}
      onDecline={() => {
        setAwaitingConsent(null);
        setConsent('declined');
        void recordAiConsent('declined');
      }}
    />

    <ScrollView
      /*
        R57. `OPTICAL_CENTRE` only has slack to distribute when the content is
        shorter than the display, which is every state on this screen — so the
        block sits a little above centre rather than pinned to the top of a
        black field. A long error keeps its natural top alignment for free.
      */
      contentContainerStyle={[styles.body, OPTICAL_CENTRE]}
    >
      {state.status === 'idle' && (
        <View style={styles.block}>
          {/*
            ── R47 · the nav title said this 40pt above ───────────────────────

            `Scan an invoice` rendered twice — once as the stack header's title
            and again as the screen's H1, with nothing between them. iOS has one
            pattern for a title that appears in both places (the large title
            that shrinks into the bar as it scrolls) and this screen was not it;
            it was simply the same words, twice.

            The nav keeps it. What the screen leads with is what happens next.
          */}
          {/*
            **No PDF claim.** This said "A PDF works too", which the server
            supports and this screen does not: the picker is `mediaTypes:
            ['images']`, so a PDF cannot be selected at all. Promising a
            capability the button in front of you cannot reach is worse than
            not mentioning it. Picking documents needs `expo-document-picker` —
            another native module, another cloud build — so it waits for the
            next one rather than costing its own.
          */}
          <Text style={styles.lead}>
            Photograph a service invoice and its line items are read and added to this car's
            history.
          </Text>

          {/*
            ── R49 · what happens next, stated before it happens ─────────────

            The screen offered two ways to start and said nothing about where
            they lead. The system's rule is that AI uncertainty is stated
            plainly, and this is the moment for it: a model reads a photograph
            and writes rows into the owner's permanent service record.

            ⚠ The review's suggested line was *"You review them before anything
            is saved."* **That is not true** and is not written here. Line items
            are written by `uploadInvoice` as soon as extraction succeeds; the
            only thing held back for confirmation is a vehicle mismatch. What is
            promised is what actually happens.
          */}
          <Text style={styles.expectation}>
            The reading is done by a model, so check the lines afterwards. If the invoice looks
            like a different car, we ask before filing it.
          </Text>
          {/*
            ── ⚠ LEG-02 · declining means "no AI features", never "no app" ────

            The controls stand down rather than the screen refusing, and the
            line below says what declining cost and how to change it. Blocking
            the product on a privacy refusal would trade a 5.1.2 problem for a
            5.1.1(v)-shaped one — and the garage, the history and the recall
            list are all useful without a model.
          */}
          {consent === 'declined' ? (
            <View style={styles.block}>
              <Text style={styles.body_}>{INVOICE_AI_CONSENT.declineNote}</Text>
              <Button
                label="Change that"
                variant="outline"
                onPress={() => setAwaitingConsent('camera')}
              />
            </View>
          ) : (
            <>
          <Button label="Take a photo" variant="primary" onPress={() => void choose('camera')} />
          {/*
            Not a fallback. Plenty of invoices arrive as an emailed PDF or a
            photo taken days ago — and the simulator has no camera at all, so a
            camera-only flow could never be exercised on the machine this is
            developed on.
          */}
          <Button
            label="Choose from library"
            variant="outline"
            onPress={() => void choose('library')}
          />
            </>
          )}
        </View>
      )}

      {state.status === 'working' && (
        <View style={styles.centred}>
          <ActivityIndicator color={text.muted} />
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
          <Button
            label="Scan another"
            variant="outline"
            onPress={() => setState({ status: 'idle' })}
          />
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
          <Button
            label="Yes, file it here"
            variant="primary"
            onPress={() => file && void send(file, true)}
            disabled={!file}
          />
          <Button
            label="No, cancel"
            variant="outline"
            onPress={() => setState({ status: 'idle' })}
          />
        </View>
      )}

      {state.status === 'not-invoice' && (
        <View style={styles.block}>
          <Text style={styles.title}>That does not look like an invoice</Text>
          <Text style={styles.body_}>{state.message}</Text>
          <Button
            label="Try another photo"
            variant="primary"
            onPress={() => void choose('camera')}
          />
          <Button
            label="Choose from library"
            variant="outline"
            onPress={() => void choose('library')}
          />
        </View>
      )}

      {state.status === 'error' && (
        <View style={styles.block}>
          <Text style={styles.title}>That did not upload</Text>
          <Text style={styles.body_}>{state.message}</Text>

          {/*
            The line that ends the guessing. Three rounds of testing could not
            answer "did the request reach the server, and how long did it take"
            from this screen, so every report had to describe symptoms and every
            reply had to hypothesise. `__DEV__` only — it is diagnostic text,
            not product copy, and it compiles out exactly as the token panel
            does.
          */}
          {__DEV__ && state.diagnostic ? (
            <Text style={styles.diagnostic}>{state.diagnostic}</Text>
          ) : null}
          {/*
            Retry resends the file already chosen rather than reopening the
            camera — the photograph may be of a bill no longer in front of the
            person holding the phone. But it is offered **only when a second
            attempt could differ**: a rejected file type fails the same way
            forever, and offering it there is what stranded a real tester.

            A way back to the picker is always present, in every branch.
          */}
          {/*
            The affordance the copy used to assume. An error that says "sign in
            again" while offering only Try again / Choose a file / Take a photo
            is an instruction with nowhere to follow it — `onSignOut` clears the
            session, which is what makes `App.tsx` show the sign-in screen.
          */}
          {state.signInMayHelp ? (
            <Button label="Sign in again" variant="primary" onPress={onSignOut} />
          ) : null}

          {state.retryable && file ? (
            <Button
              label="Try again"
              /*
                One filled control per screen. When "Sign in again" is showing
                it is the verb, so this steps down to outline — the ladder the
                variant names rather than two whites competing.
              */
              variant={state.signInMayHelp ? 'outline' : 'primary'}
              onPress={() => void send(file, false)}
            />
          ) : null}

          <Button
            label="Choose a different file"
            variant={state.retryable && file ? 'outline' : 'primary'}
            onPress={() => void choose('library')}
          />

          <Button label="Take a photo" variant="outline" onPress={() => void choose('camera')} />
        </View>
      )}
    </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  body: { ...PAGE_BODY },
  block: { gap: 12 },
  title: { color: text.primary, fontSize: 22, fontFamily: interFace('700'), fontWeight: '700', letterSpacing: -0.3 },
  /* `body_` because `body` is the container above. */
  body_: { color: text.muted, fontSize: 15, lineHeight: 22 },
  /* The one line that says what this screen is for. A step above the rest. */
  lead: { ...type.body, fontSize: 15, lineHeight: 22, color: text.secondary },
  /*
    R49. What the model does with the photograph, and where the result lands.
    Quieter than the lead — it is a caveat, not the offer — and above the floor.
  */
  expectation: { ...type.value, color: text.muted, marginTop: space.xs },

  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  note: { color: text.muted, fontSize: 14 },



  /* Monospace so an elapsed figure is scannable; dev builds only. */
  diagnostic: {
    color: text.muted,
    fontSize: 12,
    fontFamily: 'Menlo',
    marginTop: -4,
  },
});
