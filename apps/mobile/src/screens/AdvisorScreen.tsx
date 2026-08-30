import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { askAdvisor, MAX_MESSAGE_LENGTH } from '../api/consultant';
import { ApiRequestError } from '../api/client';
import Button from '../components/Button';
import EmptyState from '../components/EmptyState';
import ProvenanceRow from '../components/ProvenanceRow';
import { adviceDisclosure } from '@wellkept/core/advice-disclosure';
import { ADVISOR_AI_CONSENT } from '@wellkept/core/ai-consent-copy';
import AiConsentSheet from '../components/AiConsentSheet';
import { readAiConsent, recordAiConsent, type AiConsent } from '../onboarding/ai-consent';
import { Skeleton } from '../components/Skeleton';
import { TARGET_MIN, border, brand, radius, space, status, surface, text, type } from '../theme';
import { CONTEXT_KIND_LABELS, type ContextKind } from '@wellkept/core/consultant-context-kinds';
import type { ConsultantEstimate } from '@wellkept/core/consultant-estimate';
import EstimateWell from '../components/EstimateWell';
import { parseAnswer } from '@wellkept/core/answer-markup';
import { interFace } from '../theme/fonts';

/**
 * Phase 3.4 — ask the advisor about one car.
 *
 * The third of the three flows `cc-product-0001` says mobile is, and the one
 * carrying the App Store 4.2 Minimum Functionality argument: a garage list and
 * a detail screen are a database viewer, and this is the part that is not.
 *
 * ── Why this needed no new native dependency, and 3.3 will ──────────────────
 *
 * Text in, text out, over the `/api/v1/consultant` route that Phase 3.0 built.
 * So it costs **zero EAS builds** — the dev client already on the simulator
 * loads it from Metro like any other JS change. Invoice scan (3.3) will not be
 * free in the same way: a camera or an image picker is a native module, and
 * adding one spends a second build out of fifteen a month. That is the reason
 * this was built first and it is a scheduling fact, not a preference.
 *
 * ── The thread id is the whole state model ──────────────────────────────────
 *
 * The server owns the conversation. It reads `message_history` from the
 * database, ignores any history a caller posts, and returns the thread's id on
 * every answer. So this screen keeps exactly one piece of durable state —
 * `sessionId` — and the messages it draws are a **local echo for the eye**, not
 * the record. Reopening the screen starts a new thread; it does not resume the
 * old one, and it does not pretend to.
 *
 * ⚠ **The reason given here for that was wrong, and was wrong when written.**
 * It said resuming "is `GET`-shaped work no route exposes to a bearer token
 * yet", so a picker would mean querying Supabase from the device. But
 * `GET /api/v1/consultant/conversations` authorizes through
 * `authorizeVehicleAccess` — the same bearer-capable path every other call here
 * uses — and it shipped in **this screen's own commit**, `28ee713`.
 *
 * So no route needed building and nothing would have to touch Supabase
 * directly. What is actually missing is a conversation list in the UI and a
 * decision about whether reopening resumes the last thread or offers a choice.
 * That is a product call for Phase 5.5, not a technical blocker — recorded
 * accurately on 12 Aug 2026 after the original reason was checked and did not
 * hold.
 *
 * `sessionId` lives in a ref rather than state on purpose. It is read inside an
 * async send and never rendered, so putting it in state would schedule a render
 * for a value nothing draws, and — worse — a second message sent before that
 * render committed would read a stale id and fork the thread.
 *
 * ── Failure is four different things and they are not one alert ─────────────
 *
 * **401** — the session died. `App.tsx` swaps to sign-in as soon as it clears,
 * so this calls `onSignOut` and says so plainly rather than offering a retry
 * that cannot work.
 * **429** — the vehicle's AI allowance, keyed by vehicle in `checkRateLimit`.
 * It is temporary and the honest word is "busy", not "failed".
 * **502** — Gemini declined or timed out. The question is intact and retrying
 * is reasonable, so the text stays in the composer.
 * **0** — no connectivity, which `apiRequest` distinguishes deliberately.
 *
 * In every case the typed question is **left in the box**. Losing what someone
 * wrote is worse than any error message, and a failed send that clears the
 * composer is how a retry becomes a retype.
 */

type Turn =
  | { id: string; role: 'you'; text: string }
  | {
      id: string;
      role: 'advisor';
      text: string;
      kinds: ContextKind[];
      /**
       * Present only when the answer priced something, which is rarely.
       * Optional here for the same reason it is optional on the wire — a well
       * that renders on ordinary advice would show a price nobody inferred.
       */
      estimate?: ConsultantEstimate;
    };

/**
 * Ids for the list, not identity. `Date.now()` alone collides when a question
 * and its answer land in the same millisecond, which is exactly what happens on
 * a cached or refused response.
 */
let turnCounter = 0;
function nextId(): string {
  turnCounter += 1;
  return `${Date.now()}-${turnCounter}`;
}

export function AdvisorScreen({
  vehicleId,
  vehicleTitle,
  initialQuestion,
  onSignOut,
}: {
  vehicleId: string;
  /**
   * The car this thread is about, rendered as a context row under the nav.
   *
   * ⚠ **R52.** It used to be half the nav title — `Advisor · 2015 BMW M235i` —
   * which is two pieces of information in a slot that fits one. On a 16e it
   * truncated, and truncating a nav title costs the **back button's label**
   * first: iOS gives the title the space and drops the label to a bare chevron.
   * So a long car name silently turned this screen's back control into the only
   * unlabelled one in the app, which is how it was reported (R6).
   *
   * Below the nav it can be as long as it is, and it shows what the advisor is
   * answering *about* — which is the thing a person needs to see, and the nav
   * title never was.
   */
  vehicleTitle?: string;
  /**
   * A question the screen was opened *with* — from a notification tap or a
   * deep link — asked once, automatically.
   *
   * The recall notification says "Tap to ask the advisor what it means"; before
   * this it opened an empty composer and made the person retype the question it
   * had just posed. It also unblocks testing this flow at all: synthetic
   * keystrokes do not reach a React Native `TextInput`, so the advisor was the
   * one screen that could not be exercised without a human.
   */
  initialQuestion?: string;
  onSignOut: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  /* Drives the composer's focus ring — see the panel's note at the call site. */
  const [focused, setFocused] = useState(false);

  /**
   * Whether this person has agreed their question and this car's records may go
   * to Google — LEG-02.
   *
   * ⚠ **Guideline 5.1.2(i), amended November 2025**, requires explicit
   * permission before personal data reaches a third-party AI. The disclosure
   * existed in the privacy policy; the only consent was sign-up wrap.
   *
   * Narrower than the invoice sheet on purpose: what leaves here is this car's
   * own records and the question typed — no images, no third party's business
   * details. Saying so is more useful than one generic warning covering both,
   * and somebody who agreed to the invoice sheet has already agreed to more.
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
  const [consentOpen, setConsentOpen] = useState(false);
  const pendingQuestion = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    void readAiConsent().then((answer) => {
      if (live) setConsent(answer);
    });

    return () => {
      live = false;
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionId = useRef<string | null>(null);
  const listRef = useRef<FlatList<Turn>>(null);
  const askedOnOpen = useRef(false);

  const trimmed = draft.trim();
  const overLength = trimmed.length > MAX_MESSAGE_LENGTH;
  const canSend = trimmed.length > 0 && !overLength && !busy;

  /**
   * Send one question.
   *
   * Takes the text rather than reading `draft`, so an automatic opening
   * question can be asked on the same tick it arrives — state set moments
   * earlier has not committed, and reading it here would send an empty string.
   */
  const ask = useCallback(
    async (question: string) => {
    setBusy(true);
    setError(null);
    setTurns((current) => [...current, { id: nextId(), role: 'you', text: question }]);

    try {
      const answer = await askAdvisor({
        vehicleId,
        message: question,
        sessionId: sessionId.current,
      });

      sessionId.current = answer.sessionId || sessionId.current;

      setTurns((current) => [
        ...current,
        {
          id: nextId(),
          role: 'advisor',
          text: answer.response,
          kinds: answer.contextKinds,
          ...(answer.estimate ? { estimate: answer.estimate } : {}),
        },
      ]);
      // Only now, because the question is only safely somewhere else once the
      // answer exists. Every failure path below leaves it in the composer.
      setDraft('');
    } catch (caught) {
      const apiError = caught as ApiRequestError;

      /*
        The optimistic "you" turn is rolled back. It was drawn to make the send
        feel immediate, and leaving it above an error implies a question was
        asked and ignored — when in fact nothing reached the advisor. The text
        is still in the composer, so nothing is lost by removing it.
      */
      setTurns((current) => current.slice(0, -1));

      if (apiError.status === 401) {
        setError('Your session ended. Sign in again to keep talking.');
        onSignOut();
      } else if (apiError.status === 429) {
        setError('This car has asked a lot of questions recently. Try again in a minute.');
      } else if (apiError.status === 502) {
        setError('The advisor could not answer that one. Your question is still here — try again.');
      } else {
        setError(apiError.message);
      }
    } finally {
      setBusy(false);
    }
    },
    [vehicleId, onSignOut]
  );

  /** The composer's send. Guards on what the user may do; `ask` does the work. */
  const send = useCallback(() => {
    if (!canSend) return;

    /*
      ⚠ **Asked before the question leaves, not after** (LEG-02). Consent
      obtained once a model has already answered is consent for something that
      has happened.

      The question is held so accepting sends it rather than making them type it
      again — a consent sheet that loses your work reads as an obstacle.
    */
    if (consent === 'unknown') {
      pendingQuestion.current = trimmed;
      setConsentOpen(true);
      return;
    }

    void ask(trimmed);
  }, [canSend, trimmed, ask, consent]);

  /*
    Asked once per mount, guarded by a ref rather than state: React mounts
    effects twice in development, and a second automatic send would fork the
    thread and spend a second model call on the same question.
  */
  useEffect(() => {
    const question = initialQuestion?.trim();
    if (!question || askedOnOpen.current) return;

    /*
      ⚠ **Waits for the consent read.** `null` is "still reading", and acting on
      it would burn the one-shot ref below before the answer arrived — leaving a
      notification's question typed into the composer and never sent.
    */
    if (consent === null) return;

    askedOnOpen.current = true;
    setDraft(question);

    /*
      ⚠ **The gate applies to a link too** (LEG-02). This path is a notification
      tap — "Tap to ask the advisor what it means" — and it sends a question and
      this car's records to Google without anybody typing. A consent requirement
      that the app's own deep link walks around is not a consent requirement.

      The question is already in the composer, so declining leaves it there to
      send by hand later rather than losing it.
    */
    if (consent === 'unknown') {
      pendingQuestion.current = question;
      setConsentOpen(true);
      return;
    }

    if (consent === 'declined') return;

    // Deliberately not routed through `send`, which reads `trimmed` from state
    // that has not committed yet on this tick.
    void ask(question);
  }, [initialQuestion, ask, consent]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      /*
        The stack header is outside this view, so without offsetting its height
        the composer lifts to the wrong place and sits under the keyboard's top
        edge. 96 is the large-title header plus the safe area on the 16e.
      */
      keyboardVerticalOffset={Platform.OS === 'ios' ? 96 : 0}
    >
      {/*
        ── ⚠ LEG-02 · explicit permission before the question leaves ─────────

        Declining does not block the screen: the transcript, the starter rows
        and the composer all stay, and the composer's own note explains what is
        off. Blocking the product on a privacy refusal would trade a 5.1.2
        problem for a 5.1.1(v)-shaped one.
      */}
      <AiConsentSheet
        visible={consentOpen}
        copy={ADVISOR_AI_CONSENT}
        onAccept={() => {
          const question = pendingQuestion.current;
          pendingQuestion.current = null;
          setConsentOpen(false);
          setConsent('granted');
          void recordAiConsent('granted');
          /* `ask`, not `send` — the gate is satisfied and `send` would re-read it. */
          if (question) void ask(question);
        }}
        onDecline={() => {
          pendingQuestion.current = null;
          setConsentOpen(false);
          setConsent('declined');
          void recordAiConsent('declined');
        }}
      />

      {/*
        ── R52 · the car, under the nav rather than inside its title ─────────

        A quiet line, not a chip and not a heading: it names what the thread is
        about and gets out of the way. It is above the transcript so it does not
        scroll off — the context is true for every turn, not just the first.
      */}
      {vehicleTitle ? (
        <View style={styles.context}>
          <Text style={styles.contextLabel} numberOfLines={1}>
            About {vehicleTitle}
          </Text>
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        data={turns}
        keyExtractor={(turn) => turn.id}
        contentContainerStyle={styles.transcript}
        renderItem={({ item }) => <TurnView turn={item} />}
        ListEmptyComponent={<AdvisorEmptyState onPick={setDraft} />}
        /*
          Content-size rather than a call after each setState: the answer's
          height is not known until it has laid out, and scrolling before that
          lands part-way up a long reply.
        */
        onContentSizeChange={() => {
          if (turns.length > 0) listRef.current?.scrollToEnd({ animated: true });
        }}
        keyboardDismissMode="interactive"
      />

      {busy ? (
        <View style={styles.thinking}>
          {/*
            A stage label plus bars shaped like the answer that is coming —
            not a centred spinner. An advisor reply is three or four lines of
            prose, so that is what waits in its place; a spinner says only
            "something is happening somewhere".

            The label is the honest part: it names the stage rather than
            implying progress nobody is measuring.
          */}
          <Text style={styles.thinkingText}>Reading this car's history…</Text>
          <View style={styles.thinkingBars}>
            <Skeleton width="100%" />
            <Skeleton width="92%" />
            <Skeleton width="60%" />
          </View>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/*
        ── R51 · a panel with its own focus ring, not a field in a row ───────

        The border used to be on the `TextInput`, inside a row that also held
        the button — so the composer read as two controls that happened to be
        adjacent, and the focused edge belonged to the smaller of them. Now the
        panel carries the border and the ring, and the send control lives inside
        it: one object, which is what it is.
      */}
      <View style={[styles.composer, focused && styles.composerFocused]}>
        <TextInput
          style={styles.input}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          value={draft}
          onChangeText={setDraft}
          placeholder="Type a question"
          /*
            ⚠ Named, because a placeholder is not a label — and this was the one
            unlabelled input left in the app, on the screen the product's whole
            argument rests on. VoiceOver reads a placeholder as the field's
            *value* while it is empty and drops it entirely once someone types,
            so a returning screen-reader user found an unnamed box containing
            their own half-written question. `Field` states this rule; this
            input cannot be a `Field` — a chat composer takes no visible label —
            so it carries the name directly.
          */
          accessibilityLabel="Ask about this car"
          placeholderTextColor={text.muted}
          multiline
          // Not `editable={!busy}`: a disabled input drops the keyboard and
          // loses the caret, and there is nothing wrong with typing the next
          // question while this one is in flight. Only sending is gated.
          returnKeyType="default"
        />
        {/*
          The filled primary, from the primitive.

          ⚠ It also puts this on the 44pt floor. The hand-rolled version had
          `paddingVertical: 13` and no `minHeight`, so its height depended on
          the label's line box — which is how a control quietly stops meeting a
          coarse-pointer target without anyone changing a number.

          `small` rather than `large`: it sits beside the composer's input, and
          the size names the type weight, never the height. Both clear 44.
        */}
        <Button
          label="Ask"
          variant="primary"
          size="small"
          onPress={() => void send()}
          disabled={!canSend}
          accessibilityLabel="Send question to the advisor"
        />
      </View>

      {consent === 'declined' ? (
        <Text style={styles.declineNote}>
          {ADVISOR_AI_CONSENT.declineNote}{' '}
          <Text style={styles.declineAction} onPress={() => setConsentOpen(true)}>
            Change that
          </Text>
        </Text>
      ) : null}

      {overLength ? (
        <Text style={styles.counter}>
          {trimmed.length.toLocaleString()} / {MAX_MESSAGE_LENGTH.toLocaleString()} — too long to
          send
        </Text>
      ) : null}
    </KeyboardAvoidingView>
  );
}

/**
 * The advisor's answer, with the small amount of markup it actually emits.
 *
 * It rendered as raw text until 5 Aug, so a real answer showed literal
 * `**$1,461**` and `* **Front Brakes & Rotors:**` on screen. The web had a bold
 * renderer and the phone had nothing — the same one-client capability gap as
 * the health band and the context-kind labels, which is why the parsing now
 * lives in `@wellkept/core/answer-markup` and only the drawing is here.
 *
 * Bullets get a real bullet glyph and a hanging indent rather than the
 * asterisk the model wrote, because a list on a phone should look like a list.
 */
function AnswerText({ answer }: { answer: string }) {
  return (
    <View style={styles.answer}>
      {parseAnswer(answer).map((line, index) => {
        /*
          An empty line is spacing the model asked for. Rendering it as an
          empty `Text` would collapse it, so it becomes a fixed gap — otherwise
          paragraphs run together and a long answer becomes a wall.
        */
        if (line.tokens.length === 1 && line.tokens[0].text.trim() === '' && line.kind === 'text') {
          return <View key={index} style={styles.answerGap} />;
        }

        /*
          ⚠ **FN-14.** Bold was the only run this drew, so single-asterisk
          emphasis reached the screen as literal asterisks — the same defect the
          web had, on the same shared tokeniser. Both flags can be set at once
          (`***x***`), so the styles compose rather than branching three ways.
        */
        const content = line.tokens.map((token, tokenIndex) => (
          <Text
            key={tokenIndex}
            style={[token.bold && styles.advisorBold, token.italic && styles.advisorItalic]}
          >
            {token.text}
          </Text>
        ));

        if (line.kind === 'bullet') {
          return (
            <View key={index} style={styles.bulletRow}>
              <Text style={styles.bulletMark}>{'\u2022'}</Text>
              <Text style={styles.advisorText}>{content}</Text>
            </View>
          );
        }

        return (
          <Text key={index} style={styles.advisorText}>
            {content}
          </Text>
        );
      })}
    </View>
  );
}

/**
 * One turn.
 *
 * The provenance row renders only under an advisor turn that carried kinds, and
 * the prefix is **"Based on"** — what the server loaded and put in front of the
 * model, not what the model used. `@wellkept/core/consultant-context-kinds`
 * holds the full argument for that wording, and the web chat draws the same row
 * from the same labels.
 */
function TurnView({ turn }: { turn: Turn }) {
  if (turn.role === 'you') {
    return (
      <View style={styles.youRow}>
        <View style={styles.youBubble}>
          <Text style={styles.youText}>{turn.text}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.advisorRow}>
      <AnswerText answer={turn.text} />
      {/*
        A quiet line, not a row of badges.

        Two reasons, and the second was a live defect. A badge beside a
        generated answer borrows the appearance of a verified one — which is why
        `ProvenanceRow` is deliberately not a `Chip`. And these chips rendered
        at **11px**, under the 12px floor: the same defect the design system
        carries in its own `.chip`, reached independently here. `type.label` is
        12 and the primitive has no size prop.
      */}
      <ProvenanceRow kinds={turn.kinds.map((kind) => CONTEXT_KIND_LABELS[kind])} />
      {/*
        Below the provenance line, not above it.

        The order is an argument about what the numbers are. Provenance
        qualifies the whole answer — what the advisor could see when it said
        this — and the prices are part of what was said, so they sit inside the
        scope that sentence sets rather than after it. Put the well first and
        the "Based on" line reads as a footnote to the estimate alone, which
        narrows a claim that was never that narrow.
      */}
      {turn.estimate ? <EstimateWell estimate={turn.estimate} /> : null}

      {/*
        ── ⚠ UX-16 / LEG-05 · the disclosure, where the advice is ────────────

        **The product never said its advice was AI-generated**, and the safety
        disclaimer lived only on a Terms page nobody opens. A disclaimer at the
        point of advice is worth far more than one behind a link.

        Under every turn rather than once at the top: somebody scrolling a long
        conversation reads the answer, not the header. The wording comes from
        `@wellkept/core/advice-disclosure` so it is identical on both clients —
        a safety sentence that says one thing on the phone and another on the
        web is this codebase's most repeated defect applied to the sentence that
        limits liability.

        ⚠ Below the estimate, not above it. It qualifies everything in the turn
        including the prices, and a line placed before them would read as
        qualifying only the prose.
      */}
      <Text style={styles.disclosure}>{adviceDisclosure('consultant')}</Text>
    </View>
  );
}

/**
 * The empty state names what the advisor can see, because the alternative is a
 * blank screen that invites "what do I even ask".
 *
 * ⚠ The three examples are **not** canned prompts to tap. Making them buttons
 * would turn a conversation into a menu on the first screen a new user meets,
 * which is why they go through `EmptyState`'s `children` — a slot the primitive
 * documents as taking quiet content and never controls.
 *
 * ── Why this used the primitive late ────────────────────────────────────────
 *
 * It was a local function *called `EmptyState`*, shadowing the import that
 * would have replaced it. A private copy is easy to spot when it is named
 * `emptyBlock`; one wearing the primitive's own name is invisible, and this is
 * how the primitive reached 15 Aug with zero callers while four screens rolled
 * their own.
 */
const STARTERS = [
  'Is the timing chain something I should worry about?',
  'What should I do at the next service?',
  'Is $1,400 fair for front control arms?',
];

/**
 * ── R50: the starters are rows, and R54: they sit near the composer ─────────
 *
 * They were three bare `<Text>` lines inside `EmptyState`'s `children`, which
 * centres. Three questions of three different lengths, centred, produced a
 * ragged stack with no container and no edge to align to — reported as "each a
 * different indent, ragged, centre-ish". The block was also at the **top** of a
 * 60%-empty screen, so the eye travelled header → prompts → composer across a
 * void.
 *
 * Both are fixed by shape rather than by nudging: full-width rows on
 * `surface.raised` with a hairline border, and the whole block pushed to the
 * foot of the list so the three things a new user reads are within a thumb of
 * each other.
 *
 * ⚠ **Tapping fills the composer; it does not send.** `EmptyState`'s own rule
 * was that these must not be controls, because "making them buttons would turn
 * a conversation into a menu on the first screen a new user meets". That
 * concern is real and survives here: the question lands in the composer, where
 * it can be edited or deleted, and asking it is still a deliberate second act.
 * They moved out of `EmptyState.children` rather than that rule being relaxed —
 * the primitive still takes no controls.
 */
function AdvisorEmptyState({ onPick }: { onPick: (question: string) => void }) {
  return (
    <View style={styles.emptyWrap}>
      <EmptyState
        align="start"
        headline="Ask about this car"
        body="The advisor already knows its service history, open issues, recalls and mods. You do not need to explain them."
      />

      <View style={styles.starters}>
        {STARTERS.map((question) => (
          <Pressable
            key={question}
            onPress={() => onPick(question)}
            accessibilityRole="button"
            /*
              Named as what it does, because the visible text is a question and
              a screen reader announcing only the question leaves it ambiguous
              whether tapping asks it or writes it.
            */
            accessibilityLabel={`Start with: ${question}`}
            style={({ pressed }) => [styles.starterRow, pressed && styles.starterRowPressed]}
          >
            <Text style={styles.starterText}>{question}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: surface.page },

  transcript: { padding: space.lg, gap: space.lg, flexGrow: 1 },

  youRow: { alignItems: 'flex-end' },
  youBubble: {
    backgroundColor: surface.well,
    borderRadius: radius.card,
    borderTopRightRadius: radius.well,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    maxWidth: '85%',
  },
  youText: { ...type.body, color: text.primary, lineHeight: 21 },

  advisorRow: { gap: space.sm },
  /*
    UX-16 / LEG-05. `text.muted` is the floor and this sits on it deliberately:
    quiet enough to stay out of the answer's way, never quieter than a string
    may be. Same treatment as `ProvenanceRow` above it.
  */
  disclosure: { ...type.label, letterSpacing: 0, lineHeight: 16, color: text.muted },
  advisorText: { ...type.body, color: text.primary },
  /* Weight only. A brighter colour as well would make ordinary text read as dimmed. */
  advisorBold: { fontFamily: interFace('700'), fontWeight: '700' },
  /*
    ⚠ `fontStyle`, not a second face. React Native synthesises an oblique from
    the loaded face, and Inter's italic cut is not bundled — asking for a
    `fontFamily` that is not there is how §6's silent-font-substitution defect
    happens. The synthesised slant is the honest option here.
  */
  advisorItalic: { fontStyle: 'italic' },
  answer: { gap: 2 },
  answerGap: { height: space.sm },
  /* Hanging indent: the glyph sits outside the text column so wrapped lines align. */
  bulletRow: { flexDirection: 'row', gap: space.sm, paddingRight: space.xs },
  bulletMark: { ...type.body, color: text.muted },



  thinking: { gap: space.sm, paddingHorizontal: space.lg },
  thinkingBars: { gap: space.sm },
  thinkingText: { ...type.value, color: text.muted },

  /* #f87171 — the same red SignInScreen uses, and above the AA floor on `surface.page`. */
  error: { ...type.value, color: status.dangerText, paddingHorizontal: space.lg, paddingTop: space.sm },
  counter: { fontSize: 12, color: status.dangerText, paddingHorizontal: space.lg, paddingBottom: 6 },
  /*
    LEG-02's declined state. `text.muted`, not the counter's red: declining is a
    choice somebody made, not an error they hit, and dressing it as a failure
    is how a privacy refusal starts to feel punished.
  */
  declineNote: {
    ...type.value,
    color: text.muted,
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  /* The way back. Underlined, because a coloured word is not a control. */
  declineAction: { color: brand.accent, textDecorationLine: 'underline' },

  /* ── R52 · the context row ────────────────────────────────────────────── */
  context: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.xs,
  },
  contextLabel: { ...type.value, color: text.muted },

  /* ── R50 · the starter block ──────────────────────────────────────────── */
  emptyWrap: {
    /*
      R54. `flex: 1` inside a `flexGrow: 1` content container, pushing the block
      to the foot of the list — header → starters → composer within a thumb,
      rather than at the top of a 60%-empty screen with the composer far below.
    */
    flex: 1,
    justifyContent: 'flex-end',
    gap: space.lg,
  },
  starters: { gap: space.sm },
  starterRow: {
    /*
      Full width, left-aligned, `surface.raised`, hairline border, `radius.well`
      — the system's starter-row treatment. The container is what makes three
      questions of three different lengths read as a set rather than as ragged
      text.
    */
    backgroundColor: surface.raised,
    borderWidth: 1,
    borderColor: border.panel,
    borderRadius: radius.well,
    paddingHorizontal: space.md,
    /* Comfortably over the 44pt floor at one line, and grows with two. */
    paddingVertical: space.md,
    minHeight: TARGET_MIN,
    justifyContent: 'center',
  },
  starterRowPressed: { backgroundColor: surface.well, borderColor: border.fieldHover },
  starterText: { ...type.body, fontSize: 15, lineHeight: 21, color: text.primary },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    padding: space.sm,
    margin: space.md,
    backgroundColor: surface.raised,
    borderWidth: 1,
    borderColor: border.field,
    /*
      ⚠ `radius.well`, not `radius.card`. The composer is a bar on
      `surface.raised`, and `mobile-surface-ladder.test.ts` fails a container
      that claims the card radius and the bar surface at once — which the first
      draft of this panel did. The rule is right: a card radius on a bar surface
      is a card that forgot which step it was on.
    */
    borderRadius: radius.well,
  },
  /*
    The focus ring, and it is a **border colour**, never an outline or a shadow:
    both render inconsistently across the two platforms, and a ring that is
    present on one and absent on the other is worse than none.
  */
  composerFocused: { borderColor: brand.accent },
  input: {
    flex: 1,
    /*
      No border and no fill of its own. The panel around it is the control now
      — a second edge inside the first is the "field in a row" this stopped
      being.
    */
    paddingHorizontal: space.sm,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    color: text.primary,
    fontSize: 16,
    // Four lines before it scrolls, so a long question stays visible while it
    // is written without the composer eating the transcript.
    maxHeight: 120,
  },
  /*
    ⚠ **The send button's three colours are deliberately NOT tokenised**, for
    the same reason as the advisor CTA on the vehicle screen: they are measured
    values with a history.

    `sendDisabled` was `opacity: 0.35`, which put the near-black "Ask" label at
    **1.61:1** against a 4.5 floor — effectively invisible on the product's
    flagship screen. It survived every check because both guards were blind to
    it: the source scan reads colour literals and sees none in an opacity, and
    the rendered-pixel suite did not composite parent alpha until 7 Aug.

    #b8b8b8 keeps the label near 9:1 while still reading as unavailable. A
    token substitution here would re-open a defect that took two attempts to
    find, and a disabled control still has to say what it is.
  */
});
