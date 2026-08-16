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
import ProvenanceRow from '../components/ProvenanceRow';
import { Skeleton } from '../components/Skeleton';
import { border, radius, space, status, surface, text, type } from '../theme';
import { CONTEXT_KIND_LABELS, type ContextKind } from '@crewchief/core/consultant-context-kinds';
import { parseAnswer } from '@crewchief/core/answer-markup';

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
  | { id: string; role: 'advisor'; text: string; kinds: ContextKind[] };

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
  initialQuestion,
  onSignOut,
}: {
  vehicleId: string;
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
    void ask(trimmed);
  }, [canSend, trimmed, ask]);

  /*
    Asked once per mount, guarded by a ref rather than state: React mounts
    effects twice in development, and a second automatic send would fork the
    thread and spend a second model call on the same question.
  */
  useEffect(() => {
    const question = initialQuestion?.trim();
    if (!question || askedOnOpen.current) return;

    askedOnOpen.current = true;
    setDraft(question);
    // Deliberately not routed through `send`, which reads `trimmed` from state
    // that has not committed yet on this tick.
    void ask(question);
  }, [initialQuestion, ask]);

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
      <FlatList
        ref={listRef}
        data={turns}
        keyExtractor={(turn) => turn.id}
        contentContainerStyle={styles.transcript}
        renderItem={({ item }) => <TurnView turn={item} />}
        ListEmptyComponent={<EmptyState />}
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

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Ask about this car…"
          placeholderTextColor={text.muted}
          multiline
          // Not `editable={!busy}`: a disabled input drops the keyboard and
          // loses the caret, and there is nothing wrong with typing the next
          // question while this one is in flight. Only sending is gated.
          returnKeyType="default"
        />
        {/*
          The inverse CTA, from the primitive.

          ⚠ It also puts this on the 44pt floor. The hand-rolled version had
          `paddingVertical: 13` and no `minHeight`, so its height depended on
          the label's line box — which is how a control quietly stops meeting a
          coarse-pointer target without anyone changing a number.

          `small` rather than `large`: it sits beside the composer's input, and
          the size names the type weight, never the height. Both clear 44.
        */}
        <Button
          label="Ask"
          variant="inverse"
          size="small"
          onPress={() => void send()}
          disabled={!canSend}
          accessibilityLabel="Send question to the advisor"
        />
      </View>

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
 * lives in `@crewchief/core/answer-markup` and only the drawing is here.
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

        const content = line.tokens.map((token, tokenIndex) => (
          <Text key={tokenIndex} style={token.bold ? styles.advisorBold : undefined}>
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
 * model, not what the model used. `@crewchief/core/consultant-context-kinds`
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
    </View>
  );
}

/**
 * The empty state names what the advisor can see, because the alternative is a
 * blank screen that invites "what do I even ask". These three are not canned
 * prompts to tap — they are examples, and making them buttons would turn a
 * conversation into a menu on the first screen a new user meets.
 */
function EmptyState() {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>Ask about this car</Text>
      <Text style={styles.emptyBody}>
        The advisor already knows its service history, open issues, recalls and mods. You do not
        need to explain them.
      </Text>
      <Text style={styles.emptyExample}>“Is the timing chain something I should worry about?”</Text>
      <Text style={styles.emptyExample}>“What should I do at the next service?”</Text>
      <Text style={styles.emptyExample}>“Is $1,400 fair for front control arms?”</Text>
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
  advisorText: { ...type.body, color: text.primary },
  /* Weight only. A brighter colour as well would make ordinary text read as dimmed. */
  advisorBold: { fontWeight: '700' },
  answer: { gap: 2 },
  answerGap: { height: space.sm },
  /* Hanging indent: the glyph sits outside the text column so wrapped lines align. */
  bulletRow: { flexDirection: 'row', gap: space.sm, paddingRight: space.xs },
  bulletMark: { ...type.body, color: text.muted },


  empty: { flex: 1, justifyContent: 'center', gap: space.sm, paddingHorizontal: space.xs },
  emptyTitle: { ...type.title, fontSize: 20, lineHeight: 26, color: text.primary, letterSpacing: -0.3 },
  emptyBody: { ...type.body, fontSize: 14, lineHeight: 20, color: text.muted },
  emptyExample: { ...type.body, fontSize: 14, lineHeight: 20, color: text.muted },

  thinking: { gap: space.sm, paddingHorizontal: space.lg },
  thinkingBars: { gap: space.sm },
  thinkingText: { ...type.value, color: text.muted },

  /* #f87171 — the same red SignInScreen uses, and above the AA floor on `surface.page`. */
  error: { ...type.value, color: status.dangerText, paddingHorizontal: space.lg, paddingTop: space.sm },
  counter: { fontSize: 12, color: status.dangerText, paddingHorizontal: space.lg, paddingBottom: 6 },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    padding: space.md,
    borderTopWidth: 1,
    borderTopColor: border.panel,
  },
  input: {
    flex: 1,
    backgroundColor: surface.raised,
    borderWidth: 1,
    borderColor: border.field,
    borderRadius: radius.well,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.md,
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
