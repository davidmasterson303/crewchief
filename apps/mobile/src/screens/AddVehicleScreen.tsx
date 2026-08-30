import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import Button from '../components/Button';
import Field from '../components/Field';
import Suggest from '../components/Suggest';
import { apiRequest, ApiRequestError } from '../api/client';
import { decodeVin, fetchModels } from '../api/vpic';
import { validateMileageUpdate } from '@wellkept/core/mileage-tracking';
import {
  PAGE_BODY,
  TARGET_MIN,
  border,
  brand,
  radius,
  space,
  status,
  surface,
  text,
  type,
} from '../theme';
import {
  BASELINE_AGE_OPTIONS,
  type BaselineAge,
} from '@wellkept/core/onboarding-baseline';
import {
  COMMON_MAKES,
  VIN_LENGTH,
  canonicalName,
  isPlausibleModelYear,
  modelYears,
  normaliseVin,
  suggestNames,
  vinCheckDigitMatches,
  vinProblem,
} from '@wellkept/core/vehicle-catalog';
import { interFace } from '../theme/fonts';

/**
 * Add a car — the first thing a new user does, and until 8 Aug it did not exist
 * on the phone at all.
 *
 * ── Why this is the launch blocker ──────────────────────────────────────────
 *
 * `SignInScreen` could only sign in and there was no add-vehicle anywhere in
 * `apps/mobile`, so becoming a Well Kept user meant opening the web app,
 * creating an account, onboarding a car, and *then* installing this. Fine while
 * mobile was a companion. Fatal once it is the product: an App Store reviewer
 * downloads the app and cannot reach anything.
 *
 * ── A handful of fields, where the web wizard asks fourteen ─────────────────
 *
 * `createVehicle` gathers VIN, colour, drivetrain, transmission, usage profile,
 * driving style and more across five steps. This asks what identifies the car,
 * what the odometer reads, the one question the product actually branches on,
 * and — since Track A2a — one optional question about its history. Everything
 * else has a sensible default and is editable later.
 *
 * A first-run flow that demands a VIN before showing anything is a first-run
 * flow people abandon — and the dossier the model generates does not need one.
 *
 * ── The history question, and why it names the oil change ───────────────────
 *
 * A used car arrives with a past this product cannot see. Without a baseline,
 * every time-based service reports `unknown` and every mileage-based one counts
 * from the odometer rather than from the work.
 *
 * It asks about the **oil change** rather than "the last service" for a
 * mechanical reason as well as a human one: `categoryFor('service')` is `null`,
 * so a vague answer matches no scheduled item and the question would be pure
 * cost. `onboarding-baseline.ts` carries the full argument, including why every
 * "roughly when" answer resolves to the *oldest* end of its range.
 *
 * Both fields are optional and nothing gates on them. There is no skip button
 * precisely because there is nothing to skip — a button would imply a gate that
 * does not exist.
 *
 * ── Behaviour tests: the gap is closed ─────────────────────────────────────
 *
 * `AddVehicleScreen.test.tsx` covers what this screen *sends* — the mileage
 * rule refusing a bad reading before a round trip, the absence of a `user_id`
 * in the body, the mods answer, the A2a baseline fields, and a 401 signing out
 * where a 500 does not. `contrast.test.tsx` separately mounts it and measures
 * its colours.
 *
 * An earlier attempt was written and deleted rather than left broken, and the
 * reason is worth carrying — in its corrected form, because the note that
 * stood here until 15 Aug 2026 blamed the wrong thing. It said `fireEvent`
 * "does not work against this form and fails silently". What actually fails is
 * an **un-awaited** `fireEvent`: RNTL 14's `render`, `fireEvent` and
 * `userEvent` are all async, and dropping the `await` leaves React's act scope
 * open, which stops every later render in that file from committing. It cost
 * `contrast.test.tsx` a week of measuring nothing in green — `jest.setup.js`
 * carries the mechanism and now fails on it.
 *
 * **Use `userEvent` for every interaction in this app's screen tests, and
 * await it.** It is RNTL 14's async API for React 19's concurrent render and
 * it models a real press rather than a synthetic prop call.
 *
 * ── The mods question is asked here, not buried in settings ─────────────────
 *
 * It decides whether this owner ever sees the modifications surface, and
 * `showsModifications` is the whole rule. Asked plainly, with a visible way back
 * later — the dossier carries a "turn them on" control for anyone who says no,
 * which is what lets this be a single yes/no rather than something that has to
 * be got right first time.
 *
 * ── 23 Aug: three free-text cells became a catalogue ────────────────────────
 *
 * Year, make and model were bare `TextInput`s with a four-character check on
 * the year and nothing at all on the other two. The failure is silent, which is
 * this codebase's §6 exactly: `"bmw"`, `"BMW"` and `"B.M.W."` are one car to
 * the person holding it and three to every join downstream, so a typo does not
 * produce an error — it produces a car whose recalls, dossier and service
 * schedule all come back empty, looking like a product that knows nothing.
 *
 * `@wellkept/core/vehicle-catalog` carries the lists and the judgements;
 * `api/vpic.ts` carries the two network calls. What is decided *here* is the
 * shape of the form:
 *
 *   - **The VIN block is collapsed, above the fields, and optional.** The
 *     docblock above still holds — *"a first-run flow that demands a VIN before
 *     showing anything is a first-run flow people abandon"* — so the fields are
 *     never hidden behind it and it never becomes a step. It fills them in.
 *   - **Model suggestions depend on year and make**, because vPIC's model list
 *     is keyed on both. Asked before either is settled it would offer nothing,
 *     which is why the panel says what it is waiting for rather than sitting
 *     empty.
 *   - **Nothing here can block a submit.** Every list is an accelerator over a
 *     field that still accepts free text — see `Suggest` for the argument, and
 *     §10 for why a picker would be the wrong control for data this shape.
 *
 * ⚠ **The VIN is decoded and not stored.** `POST /api/v1/vehicles` builds its
 * insert from year, make, model, trim and mileage, and has no `vin` field, so
 * a car added here carries no VIN in the database — the decode is a typing aid.
 * Giving that column a value is a route change, and a route change is a
 * `web-live` promote before any build that depends on it. `api/vpic.ts` carries
 * the full reasoning; it is repeated here because this is the screen where
 * somebody will reasonably expect the VIN to have been saved.
 */

interface Props {
  onAdded: (vehicleId: string, title: string) => void;
  onSignOut: () => void;
}

/** Which suggestion panel is showing. See `Suggest` for why the form owns it. */
type OpenField = 'year' | 'make' | 'model' | null;

/**
 * How long a settled make and year have to sit still before vPIC is asked.
 *
 * The make field is free text, so every keystroke of "Subaru" is a candidate
 * make and six requests for a word nobody has finished typing is six requests
 * wasted on somebody else's API. Long enough to skip the intermediate states,
 * short enough that a chosen suggestion feels immediate.
 */
const MODEL_LOOKUP_DEBOUNCE_MS = 350;

export function AddVehicleScreen({ onAdded, onSignOut }: Props) {
  const [year, setYear] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [trim, setTrim] = useState('');
  const [mileage, setMileage] = useState('');
  const [wantsMods, setWantsMods] = useState(true);
  const [serviceMileage, setServiceMileage] = useState('');
  const [serviceAge, setServiceAge] = useState<BaselineAge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [openField, setOpenField] = useState<OpenField>(null);

  /*
    ── The VIN block ────────────────────────────────────────────────────────

    Collapsed by default, and `vinNote` is what it said last. A note rather
    than an error because two of its three outcomes are not failures: a decode
    NHTSA flagged still filled the form in, and it is worth saying so without
    painting the screen red about a car that is now correctly described.
  */
  const [vin, setVin] = useState('');
  const [vinBusy, setVinBusy] = useState(false);
  const [vinNote, setVinNote] = useState<{ tone: 'good' | 'warn'; body: string } | null>(null);

  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  /*
    Built once. `modelYears` walks from next year back to 1981 — 47 strings,
    rebuilt on every keystroke of every field if this were inline.

    ⚠ The clock is read here rather than inside `modelYears`, which takes a
    `Date` for the reason everything in this codebase does: a function with its
    own clock cannot be tested on 1 January, and this list changes on 1 January.
  */
  const years = useMemo(() => modelYears(new Date()).map(String), []);

  const yearNumber = Number(year.trim());
  const yearReady = isPlausibleModelYear(yearNumber, new Date());
  const makeReady = make.trim().length > 0;

  /*
    ── Models, when there is a make and a year to ask about ─────────────────

    ⚠ Aborted **and** flagged. `cancelled` guards the state write and the
    `AbortController` stops the three requests actually in flight; dropping
    either one produces the classic typeahead bug where an early, slow response
    lands after a later, fast one and the list snaps back to the wrong make.
  */
  useEffect(() => {
    if (!yearReady || !makeReady) {
      setModels([]);
      setModelsLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setModelsLoading(true);

    const timer = setTimeout(() => {
      void fetchModels(make.trim(), yearNumber, controller.signal).then((found) => {
        if (cancelled) return;
        setModels(found);
        setModelsLoading(false);
      });
    }, MODEL_LOOKUP_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [make, yearNumber, yearReady, makeReady]);

  /**
   * Read the car off its VIN.
   *
   * ⚠ **Fills empty fields and never overwrites a full one.** Somebody who
   * typed the make and then remembered the VIN should not watch their own
   * answer be replaced — and vPIC's `Trim` is empty far more often than not, so
   * an unconditional write would blank a trim the owner had already given. The
   * decode is additive; the owner stays the authority on anything they said.
   */
  async function lookUpVin() {
    const number = normaliseVin(vin);
    if (number.length !== VIN_LENGTH || vinBusy) return;

    setVinBusy(true);
    setVinNote(null);

    const decoded = await decodeVin(number);
    setVinBusy(false);

    if (!decoded) {
      setVinNote({
        tone: 'warn',
        /*
          Two causes, one sentence, because the next move is the same for both:
          NHTSA could not place the number, or the phone could not reach NHTSA.
          Splitting them would offer a distinction the owner cannot act on
          differently — and the fields below are right there either way.
        */
        body: 'We could not read that VIN. Fill the car in below instead — nothing here needs it.',
      });
      return;
    }

    if (decoded.year && !year.trim()) setYear(String(decoded.year));
    if (decoded.make && !make.trim()) setMake(decoded.make);
    if (decoded.model && !model.trim()) setModel(decoded.model);
    if (decoded.trim && !trim.trim()) setTrim(decoded.trim);

    const named = [decoded.year, decoded.make, decoded.model].filter(Boolean).join(' ');

    setVinNote(
      decoded.confidence === 'suspect' || !vinCheckDigitMatches(number)
        ? {
            tone: 'warn',
            /*
              Said, not enforced. Position 9 is only mandatory for North
              American builds, so a genuine import can fail it — and NHTSA
              decoded the car anyway, which is why the answer is above this
              sentence rather than withheld behind it.
            */
            body: `Filled in from the VIN: ${named}. Its check digit does not match, so read it over — and correct anything below that is wrong.`,
          }
        : { tone: 'good', body: `Filled in from the VIN: ${named}. Correct anything that is off.` }
    );
  }

  const canSubmit = yearReady && makeReady && model.trim().length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;

    /*
      ⚠ The catalogue's spelling wins, and it is applied **here** rather than as
      the owner types.

      This is the fix for the defect at the top of the file: "bmw" typed into a
      free-text cell is a different make from "BMW" to every downstream join, so
      the car it creates has no recalls, no dossier and no schedule — and looks
      like a product that knows nothing rather than like a typo.

      On submit, not on keystroke, because a field that rewrites itself under
      the finger — "bmw" becoming "BMW" as the W lands — feels like the form
      arguing with the person filling it in. `canonicalName` returns an unlisted
      make untouched, which is what keeps this a catalogue and not a gate.
    */
    const chosenMake = canonicalName(make, COMMON_MAKES);
    const chosenModel = models.length > 0 ? canonicalName(model, models) : model.trim();

    const reading = Number(mileage.replace(/[^0-9]/g, '') || '0');

    /*
      Checked here as well as on the route, and that is not redundancy for its
      own sake: the rule lives in core precisely so the phone can refuse a bad
      reading without spending a round trip, and the server can refuse it
      regardless because a client is not a guarantee.
    */
    const decision = validateMileageUpdate({ current: 0, next: reading });
    if (!decision.ok) {
      setError(decision.message ?? 'Check that reading.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const body = await apiRequest<{ vehicle?: { id: string } }>('/vehicles', {
        method: 'POST',
        body: {
          year: yearNumber,
          make: chosenMake,
          model: chosenModel,
          trim: trim.trim(),
          currentMileage: reading,
          wantsModifications: wantsMods,
          /*
            Both optional and both independently useful — a mileage with no
            date still lets every mileage-based service count from it. `null`
            rather than 0 for an untouched field: 0 is a legitimate reading and
            the route must be able to tell them apart.
          */
          lastServiceMileage: serviceMileage.trim()
            ? Number(serviceMileage.replace(/[^0-9]/g, ''))
            : null,
          lastServiceAge: serviceAge,
        },
      });

      if (!body.vehicle?.id) {
        setError('The car was not saved. Try again.');
        setBusy(false);
        return;
      }

      onAdded(body.vehicle.id, [year, chosenMake, chosenModel].filter(Boolean).join(' '));
    } catch (err) {
      const apiError = err as ApiRequestError;
      /*
        ⚠ **MOB-08.** `isLocallySignedOut`, not any 401. A `device` 401 is
        genuinely signed out; a `server` 401 may be a token the server would
        accept a second later, and destroying a working session over one
        response is how a spurious failure becomes a forced re-login. The
        client's own docblock records a real tester hitting this three times out
        of three on 5 Aug — and one screen consumed the distinction.
      */
      if (apiError.isLocallySignedOut) {
        onSignOut();
        return;
      }
      setError(apiError.message ?? 'Could not save the car.');
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Add your car</Text>
        <Text style={styles.subtitle}>
          Enough to look it up. Everything else can wait.
        </Text>

        {/*
          ── The VIN, offered and never demanded ──────────────────────────────

          Collapsed to one line, above the fields it fills rather than in front
          of them. The docblock's rule is intact: this is not a step, nothing
          waits on it, and the form below is complete and usable by somebody who
          never opens it — which is the point, because the VIN plate is under
          the windscreen and the person filling this in may be on a sofa.
        */}
        {/*
          ── The VIN leads, and the fallback is visible under it ──────────────

          ⚠ **This was a collapsed "Have the VIN?" row until 23 Aug**, with
          year/make/model as the primary form. That inverted
          `specs/native-add-vehicle.spec.html`, which puts the VIN first and
          calls year/make/model *"the genuine fallback"* that *"reads as one:
          no label, just 'or'"*.

          The two arguments looked like they conflicted and do not. This
          screen's own rule is that **a flow demanding a VIN before showing
          anything is a flow people abandon** — and the spec never demands one:
          every field is on one screen, nothing is gated, and the "or" is there
          precisely so somebody standing away from their car is not stuck. What
          the spec asks for is *priority*, not a step. Leading with the VIN and
          keeping the fallback in view satisfies both.

          Still missing against the spec: **"Scan an invoice instead"**, which
          it places beside the VIN field on the reasoning that a typed VIN and a
          scanned one are the same fidelity, and the scan returns the service
          record in the same pass. That needs vehicle extraction with no vehicle
          to attach to — a new route, and therefore a `web-live` promote (§8).
          Recorded in `docs/design-system-drift.md` rather than left implicit.
        */}
        <Text style={styles.vinLead}>
          A VIN gets the exact build — engine, trim, factory options, and every recall filed
          against it.
        </Text>

        <View style={styles.vinBlock}>
            <Field
              label="VIN"
              hint={`${VIN_LENGTH} characters`}
              /*
                The spec's own words, and they are worth keeping verbatim: most
                people do not know where a VIN is printed, and "enter your VIN"
                with no answer to that is a dead end for anyone not already
                holding their insurance card.
              */
              placeholder="On the door jamb, the windscreen, or your insurance card"
              value={vin}
              /*
                Normalised on the way in, so a VIN read aloud in groups — or
                pasted out of an insurance email with a stray space — becomes
                the thing NHTSA can be asked about. Lower case is upper cased
                for the same reason.
              */
              onChangeText={(next) => setVin(normaliseVin(next))}
              problem={vinProblem(vin) ?? undefined}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={VIN_LENGTH}
              editable={!busy && !vinBusy}
            />
            <Button
              label="Read the car off it"
              variant="outline"
              onPress={() => void lookUpVin()}
              disabled={vin.length !== VIN_LENGTH || busy}
              busy={vinBusy}
            />
            {vinNote ? (
              /*
                `accessibilityLiveRegion`, because the fields below have just
                changed and a screen-reader user has no other way to know it
                happened — the same reason `Field` announces its own problem.
              */
              <Text
                accessibilityLiveRegion="polite"
                style={[styles.vinNote, vinNote.tone === 'warn' && styles.vinNoteWarn]}
              >
                {vinNote.body}
              </Text>
            ) : null}
        </View>

        {/*
          The fallback, and the spec is specific that it "reads as one: no
          label, just 'or'". A heading here — "Or enter the details" — would
          make it a second form rather than the same form's other end.
        */}
        <View style={styles.orRow}>
          <View style={styles.orRule} />
          <Text style={styles.orText}>or</Text>
          <View style={styles.orRule} />
        </View>

        {/*
          `Field`, and the visible labels are the upgrade.

          This form asked for six values through placeholders alone, so every
          label vanished the moment someone typed — on the one screen a new user
          cannot skip. The accessible names are unchanged because the primitive
          takes the label it speaks, and `hint` now carries "optional" into that
          name rather than showing it only to people who can see it.

          ⚠ The two-column year/make row is **gone**, and that is what the
          suggestions cost. A panel under a 96pt column would be 96pt wide, and
          one under the make would open beside the year rather than beneath the
          form. Stacked, each field owns the full width its list needs. The
          labels and therefore the accessible names are unchanged.
        */}
        <Suggest
          label="Model year"
          value={year}
          onChangeText={setYear}
          onPick={(picked) => {
            setYear(picked);
            setOpenField(null);
          }}
          /*
            Filtered by what has been typed, so "201" narrows to that decade.
            Six rather than eight: a year is four characters and somebody who
            has typed three of them is one row away from the answer.
          */
          suggestions={suggestNames(year, years, 6)}
          open={openField === 'year'}
          onOpen={() => setOpenField('year')}
          problem={
            /*
              Only once four characters are in. Complaining at "20" would be
              the form telling somebody they are wrong while they are still
              typing, which is the fastest way to teach people to ignore it.
            */
            year.trim().length >= 4 && !yearReady
              ? `Model years run from ${years[years.length - 1]} to ${years[0]}.`
              : undefined
          }
          keyboardType="number-pad"
          maxLength={4}
          editable={!busy}
        />

        <Suggest
          label="Make"
          value={make}
          onChangeText={setMake}
          onPick={(picked) => {
            setMake(picked);
            /*
              The model is cleared, not kept. A model belongs to a make, and an
              Accord left sitting under Subaru is the one state this form must
              never submit — it typechecks, it looks filled in, and it creates a
              car that does not exist.
            */
            setModel('');
            setOpenField(null);
          }}
          suggestions={suggestNames(make, COMMON_MAKES)}
          open={openField === 'make'}
          onOpen={() => setOpenField('make')}
          autoCapitalize="words"
          editable={!busy}
        />

        <Suggest
          label="Model"
          value={model}
          onChangeText={setModel}
          onPick={(picked) => {
            setModel(picked);
            setOpenField(null);
          }}
          suggestions={suggestNames(model, models)}
          loading={modelsLoading}
          /*
            The panel says what it is waiting for rather than sitting empty. An
            empty list has three causes an owner can tell apart — no year yet,
            no make yet, and NHTSA having nothing for that pair — and only the
            third is a dead end. A silent panel makes all three look broken.

            ⚠ The third sentence claims nothing about the car. NHTSA not listing
            a model is a fact about NHTSA, and this product does not turn that
            into "your car does not exist".
          */
          quiet={
            !yearReady || !makeReady
              ? 'Pick a model year and a make and we will list what was built.'
              : `We have no models listed for a ${yearNumber} ${make.trim()}. Type it in — it will still work.`
          }
          open={openField === 'model'}
          onOpen={() => setOpenField('model')}
          autoCapitalize="words"
          editable={!busy}
        />

        <Field
          label="Trim"
          hint="optional"
          value={trim}
          onChangeText={setTrim}
          autoCapitalize="words"
          editable={!busy}
        />

        <Field
          label="Current mileage"
          value={mileage}
          onChangeText={setMileage}
          keyboardType="number-pad"
          editable={!busy}
        />

        <View style={styles.modsBlock}>
          <Text style={styles.modsQuestion}>Interested in modifications?</Text>
          <Text style={styles.modsHint}>
            A running list of what this car could have done next. You can change this later.
          </Text>

          <View style={styles.row}>
            {[
              { value: true, label: 'Yes' },
              { value: false, label: 'Not for me' },
            ].map(({ value, label }) => (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityState={{ selected: wantsMods === value }}
                style={[styles.choice, wantsMods === value && styles.choiceOn]}
                onPress={() => setWantsMods(value)}
                disabled={busy}
              >
                <Text style={[styles.choiceText, wantsMods === value && styles.choiceTextOn]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/*
          Track A2a. One question, and it names the work rather than asking
          about "the last service" — see `onboarding-baseline.ts` for why
          "service" is unanswerable *and* unmatchable. Both fields are optional
          and the screen submits perfectly well with neither touched.
        */}
        <View style={styles.modsBlock}>
          <Text style={styles.modsQuestion}>When was its last oil change?</Text>
          <Text style={styles.modsHint}>
            Optional, and a rough answer is genuinely useful — it is what lets us
            count from the work rather than guess from the odometer.
          </Text>

          <Field
            label="Mileage at last oil change"
            hint="optional"
            value={serviceMileage}
            onChangeText={setServiceMileage}
            keyboardType="number-pad"
            editable={!busy}
          />

          <View style={styles.ageGrid}>
            {BASELINE_AGE_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: serviceAge === option.value }}
                style={[styles.age, serviceAge === option.value && styles.choiceOn]}
                onPress={() =>
                  setServiceAge((held) => (held === option.value ? null : option.value))
                }
                disabled={busy}
              >
                <Text
                  style={[styles.ageText, serviceAge === option.value && styles.choiceTextOn]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/*
            The skip is a statement, not a control, and that is deliberate.
            Nothing here is required, so a "skip" button would imply the block
            above is a gate it is not — and the invoice scanner is reachable
            from the car itself the moment it exists, which is a better moment
            to offer it than before the car has been created.
          */}
          <Text style={styles.footnote}>
            Or leave this blank — you can scan your receipts later and we will read
            the dates off them.
          </Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/*
          The filled primary from the primitive — the sixth and last private copy
          of a treatment four tokens existed for and no component owned.
        */}
        <Button
          label="Add to my garage"
          variant="primary"
          onPress={() => void submit()}
          disabled={!canSubmit}
          busy={busy}
        />

        {/*
          Said plainly rather than left as a surprise. The dossier takes ~23s to
          generate and the route deliberately does not wait for it, so the car
          appears immediately and its detail fills in behind. Someone who is not
          told that reads the empty dossier as a broken app.
        */}
        <Text style={styles.footnote}>
          Your car appears straight away. We look up its known issues and service schedule in
          the background — that takes a few seconds.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: surface.page },
  body: { ...PAGE_BODY },

  title: { color: text.primary, fontSize: 26, fontFamily: interFace('700'), fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: text.secondary, fontSize: 14, marginBottom: 6 },

  row: { flexDirection: 'row', gap: 10 },

  /*
    ── The VIN block ────────────────────────────────────────────────────────

    A well rather than a card, because it is a tool inside the form and not a
    section of it. The collapsed offer is deliberately quiet: it is worth
    finding and it is not the thing this screen is asking for.
  */
  vinBlock: {
    gap: space.md,
    padding: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: border.field,
    backgroundColor: surface.well,
  },
  /*
    ⚠ `text.secondary`, not the confirm green, for the good case.

    A decode that worked is not a success message — it is a sentence saying
    where the values below came from, and painting it green would make an
    ordinary step feel like an achievement while leaving the warn case looking
    like a failure. Only the warn tone changes colour, because only it is
    asking for something.
  */
  vinLead: { ...type.body, color: text.secondary },
  /*
    A rule, a word, a rule. `border.panel` rather than `border.field`: this
    separates two halves of one form, it is not the edge of a control.
  */
  orRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginVertical: space.sm },
  orRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: border.panel },
  orText: { ...type.label, letterSpacing: 0, color: text.muted },
  vinNote: { ...type.value, color: text.secondary, lineHeight: 18 },
  vinNoteWarn: { color: status.attention },


  modsBlock: { gap: 8, marginTop: 8 },
  modsQuestion: { color: text.primary, fontSize: 16, fontFamily: interFace('600'), fontWeight: '600' },
  modsHint: { color: text.secondary, fontSize: 13, lineHeight: 18 },

  choice: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: surface.raised,
  },
  ageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  age: {
    minHeight: 44,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: radius.button,
    backgroundColor: surface.raised,
  },
  ageText: { color: text.secondary, fontSize: 14, fontFamily: interFace('600'), fontWeight: '600' },

  /*
    ⚠ The selected state is the brand fill, not white. It was `surface.inverse`
    until 23 Aug, which put a white fill on a screen whose primary button is
    cyan — the same two-filled-treatments conflict the retired `inverse` button
    variant caused, one control down. See `Button`'s docblock.
  */
  choiceOn: { backgroundColor: brand.primary },
  choiceText: { color: text.secondary, fontSize: 15, fontFamily: interFace('600'), fontWeight: '600' },
  choiceTextOn: { color: text.onPrimary },

  error: { color: status.dangerText, fontSize: 13, lineHeight: 18 },

  /* An explicit fill, never `opacity` — the contrast audit cannot composite a
     parent alpha, so a faded control is an unmeasured one. See WishlistScreen. */

  footnote: { color: text.secondary, fontSize: 12, lineHeight: 18, marginTop: 4 },
});
