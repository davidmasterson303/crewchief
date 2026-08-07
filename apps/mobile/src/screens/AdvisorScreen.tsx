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
 * old one, and it does not pretend to. Resuming is a session list, which is
 * `GET`-shaped work no route exposes to a bearer token yet, so building a
 * picker here would mean querying Supabase from the device — the second answer
 * to "who may see what" that `api/client.ts` exists to prevent.
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
          <ActivityIndicator color="rgba(255,255,255,0.5)" size="small" />
          <Text style={styles.thinkingText}>Reading this car's history…</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Ask about this car…"
          placeholderTextColor="rgba(255,255,255,0.3)"
          multiline
          // Not `editable={!busy}`: a disabled input drops the keyboard and
          // loses the caret, and there is nothing wrong with typing the next
          // question while this one is in flight. Only sending is gated.
          returnKeyType="default"
        />
        <Pressable
          style={[styles.send, !canSend && styles.sendDisabled]}
          onPress={() => void send()}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="Send question to the advisor"
        >
          <Text style={styles.sendText}>Ask</Text>
        </Pressable>
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
      {turn.kinds.length > 0 ? (
        <View style={styles.chipRow}>
          <Text style={styles.chipPrefix}>Based on</Text>
          {turn.kinds.map((kind) => (
            <View key={kind} style={styles.chip}>
              <Text style={styles.chipText}>{CONTEXT_KIND_LABELS[kind]}</Text>
            </View>
          ))}
        </View>
      ) : null}
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
  container: { flex: 1, backgroundColor: '#080808' },

  transcript: { padding: 18, gap: 18, flexGrow: 1 },

  youRow: { alignItems: 'flex-end' },
  youBubble: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 16,
    borderTopRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '85%',
  },
  youText: { color: '#fff', fontSize: 15, lineHeight: 21 },

  advisorRow: { gap: 8 },
  advisorText: { color: 'rgba(255,255,255,0.92)', fontSize: 15, lineHeight: 22 },
  /* Weight only. A brighter colour as well would make ordinary text read as dimmed. */
  advisorBold: { fontWeight: '700' },
  answer: { gap: 2 },
  answerGap: { height: 8 },
  /* Hanging indent: the glyph sits outside the text column so wrapped lines align. */
  bulletRow: { flexDirection: 'row', gap: 8, paddingRight: 4 },
  bulletMark: { color: 'rgba(255,255,255,0.5)', fontSize: 15, lineHeight: 22 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  chipPrefix: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '600' },
  chip: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  chipText: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '600' },

  empty: { flex: 1, justifyContent: 'center', gap: 10, paddingHorizontal: 4 },
  emptyTitle: { color: '#fff', fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  emptyBody: { color: 'rgba(255,255,255,0.5)', fontSize: 14, lineHeight: 20 },
  emptyExample: { color: 'rgba(255,255,255,0.5)', fontSize: 14, lineHeight: 20 },

  thinking: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18 },
  thinkingText: { color: 'rgba(255,255,255,0.5)', fontSize: 13 },

  /* #f87171 — the same red SignInScreen uses, and above the AA floor on #080808. */
  error: { color: '#f87171', fontSize: 13, paddingHorizontal: 18, paddingTop: 8 },
  counter: { color: '#f87171', fontSize: 12, paddingHorizontal: 18, paddingBottom: 6 },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.10)',
  },
  input: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    color: '#fff',
    fontSize: 16,
    // Four lines before it scrolls, so a long question stays visible while it
    // is written without the composer eating the transcript.
    maxHeight: 120,
  },
  send: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  sendDisabled: { opacity: 0.35 },
  sendText: { color: '#080808', fontSize: 15, fontWeight: '600' },
});
