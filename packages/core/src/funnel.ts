/**
 * The front door's funnel — what an anonymous stranger did, and how far they got.
 *
 * Phase 2.97d. This is the half that has no database in it: the vocabulary, and
 * the rule for turning a set of reached steps into a funnel. The write needs a
 * service-role client and lives in `lib/funnel.ts`.
 *
 * ── Why this is a ship gate rather than a component ─────────────────────────
 *
 * Advisory item P1, scored 7.6 and adopted. Phase 2.97 exists to produce
 * evidence — the roadmap's own justification is that it is the only item that
 * generates demand data before money is spent forming an entity. A front door
 * that ships without this is a nicer landing page that teaches nobody anything,
 * and because it is the smallest line in the phase it is the first thing that
 * would be cut under time pressure. Hence: the door does not open without it.
 *
 * ── No vendor, and that is a decision, not an omission ──────────────────────
 *
 * There is no analytics product in this app and none is being added. A
 * third-party tracker on an anonymous endpoint pulls in a consent banner, which
 * is a conversion tax on the exact surface being measured and a new item in
 * 5.0's legal scope. Four events written to Postgres on the `ai_usage_events`
 * pattern costs less and answers the same question.
 *
 * ── The one open question, flagged rather than assumed ──────────────────────
 *
 * A first-party id set purely to measure your own funnel is a much weaker
 * consent case than a third-party tracker, but it is **not obviously "strictly
 * necessary"** either. That belongs to the same legal review 5.0 already needs.
 * It is cheaper to ask it then than to retrofit, and it does not change the
 * no-vendor recommendation — a vendor has this problem *and* the banner.
 */

/**
 * The four steps, in the order a visitor passes them.
 *
 * Order is load-bearing: `FUNNEL_STEPS.indexOf` is how `deepestStep` decides
 * which of two steps is further along, so this array is the definition of
 * "further" and not merely a list. Mirrors the CHECK constraint in
 * `20260803090000_record_the_front_door_funnel.sql`, held in step by
 * `funnel-steps.test.ts`.
 *
 *   landed    the front door rendered for someone who had not seen it
 *   uploaded  they gave it an estimate — a photograph or pasted text
 *   answered  we returned a range. This is the step that costs money
 *   saved     they clicked through to keep it, which is the conversion moment
 *
 * Adding a step means a migration, the same friction `AI_USAGE_PURPOSES`
 * carries, and for the same reason: a vocabulary that can drift is a funnel
 * that quietly stops being comparable to last week's.
 */
export const FUNNEL_STEPS = ['landed', 'uploaded', 'answered', 'saved'] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number];

/**
 * A visitor id that this module is willing to record.
 *
 * The absent case is defined rather than left to each call site, because
 * "defined behaviour when it is absent" is the part of visitor correlation that
 * gets skipped. An event with no visitor is not a bad event — it is *not a
 * funnel event at all*, because a step that cannot be joined to the other three
 * is a counter. Recording it would inflate the top of the funnel and depress
 * every rate computed from it, which is worse than the gap it fills.
 */
export function isRecordableVisitorId(visitorId: unknown): visitorId is string {
  if (typeof visitorId !== 'string') return false;
  const trimmed = visitorId.trim();
  // Bounded on both ends: empty ids collapse every visitor into one row that
  // UNIQUE (visitor_id, step) then dedupes into a single fake visitor, and an
  // unbounded one is a text column an anonymous caller controls.
  return trimmed.length >= 8 && trimmed.length <= 128 && trimmed === visitorId;
}

/* ─── Visitor identity ──────────────────────────────────────────────────────
 *
 * The half of 2.97d that costs real effort, and the reason the item was
 * re-sized from 0.5 ed to 0.75. There is no anonymous identity anywhere in this
 * app — `checkRateLimit` takes a caller-supplied string, not an IP or a cookie —
 * so this is new, and it is what makes four events a funnel rather than four
 * counters.
 *
 * The policy lives here, portable and testable. The glue that reads and writes
 * an actual cookie needs `next/headers` and lives in `lib/funnel-visitor.ts`,
 * the same split as every other module in this package.
 */

/**
 * The cookie name.
 *
 * `cc_` prefix to match `cc_intro_played`, the only other first-party key this
 * app sets.
 */
export const VISITOR_COOKIE = 'cc_fv';

/**
 * How long a visitor id survives. **24 hours, and short on purpose.**
 *
 * The funnel it has to span is one sitting — land, upload, get an answer,
 * decide. A day covers that with room for someone who comes back after lunch,
 * and it stops well short of the durable cross-session identifier that would
 * make this a tracking cookie rather than a measurement one.
 *
 * That distinction is not decoration. It is the whole basis of the argument in
 * the roadmap that this is a weaker consent case than a third-party tracker,
 * and the thing 5.0's legal review will actually be asked about. Raising this
 * to weeks would quietly move the answer.
 *
 * The cost is honest: a visitor who returns on day three is a new visitor, so
 * repeat-visit conversion is invisible to this table. That is a question this
 * instrument deliberately cannot answer.
 */
export const VISITOR_TTL_SECONDS = 60 * 60 * 24;

/** Current id scheme. Bumped if the format changes, so old ids stay readable. */
const VISITOR_PREFIX = 'v1_';

/**
 * Format a visitor id from caller-supplied randomness.
 *
 * Takes the uuid rather than generating one so this module stays free of Node
 * built-ins and `globalThis.crypto` — React Native provides neither
 * `crypto.randomUUID` nor `node:crypto`, and this package is imported by the
 * mobile client. The caller has a source of randomness; this decides the shape.
 */
export function formatVisitorId(uuid: string): string {
  // Dashes stripped so the id is one token in a log line and in a URL, should
  // it ever appear in either. 3 + 32 = 35 characters, inside the 8..128 bound
  // `isRecordableVisitorId` and the database CHECK both enforce.
  return `${VISITOR_PREFIX}${uuid.replace(/-/g, '')}`;
}

/**
 * Cookie attributes. Every one of these is load-bearing.
 *
 * `httpOnly` — nothing in the browser needs to read this. The four events are
 * recorded server-side, so exposing it to script would add a fingerprinting
 * surface and buy nothing.
 *
 * `sameSite: 'lax'` — the front door is reached from a forum link, which is a
 * top-level cross-site GET. `strict` would withhold the cookie on exactly that
 * navigation, so every visitor arriving from the M1 distribution channel would
 * be issued a fresh id on their second page and the funnel would show a
 * hundred percent bounce. `none` would make it a cross-site cookie, which it
 * is not.
 *
 * `secure` — off only for local http development, where the browser would
 * otherwise refuse the cookie entirely.
 */
export function visitorCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: VISITOR_TTL_SECONDS,
  };
}

/**
 * Whether this request is a prefetch rather than a person arriving.
 *
 * `landed` is the awkward event — it fires on a render, and Next prefetches
 * links in the viewport, so without this the top of the funnel counts pages
 * nobody looked at and every conversion rate below it is divided by a made-up
 * number. Silent, and in the flattering direction for bounce and the
 * unflattering one for conversion.
 *
 * Three headers because three generations of the same idea are in the wild and
 * the app is served to whatever the visitor happens to be running:
 * `next-router-prefetch` is Next's own, `Sec-Purpose` is the current standard,
 * and `purpose: prefetch` is what older Chrome and some proxies still send.
 *
 * Reloads are *not* handled here — `UNIQUE (visitor_id, step)` already collapses
 * them, which is why that constraint is in the schema.
 */
export function isPrefetchRequest(header: (name: string) => string | null | undefined): boolean {
  if (header('next-router-prefetch')) return true;

  const secPurpose = header('Sec-Purpose') ?? header('sec-purpose');
  if (secPurpose && secPurpose.toLowerCase().includes('prefetch')) return true;

  const purpose = header('purpose') ?? header('Purpose') ?? header('x-purpose');
  if (purpose && purpose.toLowerCase() === 'prefetch') return true;

  return false;
}

export interface VisitorDecision {
  /** The id to attribute this request's events to, or `null` to record nothing. */
  visitorId: string | null;
  /** Whether the caller must write the cookie onto the response. */
  issue: boolean;
}

/**
 * Read-or-issue, as a decision rather than an effect.
 *
 * The whole policy in one pure function, for the reason `decideIntro` gives:
 * this is the part that can be wrong in ways nobody notices. A funnel with a
 * subtly wrong denominator looks exactly like a funnel.
 *
 * Three cases, and the middle one is the one worth having:
 *
 *   existing valid id  →  reuse it, write nothing. A reload keeps its identity,
 *                         and re-issuing would make one visitor look like two
 *   prefetch           →  no id, nothing recorded. A link in a viewport is not
 *                         a visit, and issuing here would burn an id on a
 *                         person who never arrives — then the real navigation
 *                         reuses it and `landed` is attributed to a prefetch
 *   otherwise          →  issue
 *
 * A cookie that exists but fails `isRecordableVisitorId` is replaced rather
 * than trusted. It is an anonymous caller's text, so it is either corrupt or
 * hand-written, and neither should reach the database on the strength of
 * having been in a cookie jar.
 */
export function decideVisitor({
  existing,
  prefetch,
  newId,
}: {
  existing: string | null | undefined;
  prefetch: boolean;
  newId: string;
}): VisitorDecision {
  if (isRecordableVisitorId(existing)) {
    return { visitorId: existing, issue: false };
  }

  if (prefetch) {
    return { visitorId: null, issue: false };
  }

  return { visitorId: newId, issue: true };
}

/**
 * The furthest step a visitor reached, or `null` if they reached none.
 *
 * A funnel is "how far did each visitor get", not "how many events fired" —
 * those differ the moment anyone reloads, and reloads are the common case on a
 * page someone was linked to. Deduping is the database's job (see the UNIQUE
 * constraint); ranking is this function's.
 */
export function deepestStep(steps: readonly FunnelStep[]): FunnelStep | null {
  let deepest: FunnelStep | null = null;
  let deepestIndex = -1;

  for (const step of steps) {
    const index = FUNNEL_STEPS.indexOf(step);
    if (index > deepestIndex) {
      deepestIndex = index;
      deepest = step;
    }
  }

  return deepest;
}

/**
 * Turn per-visitor step sets into the four counts a funnel is read from.
 *
 * Cumulative, not exclusive: a visitor who reached `answered` counts in
 * `landed` and `uploaded` too, whether or not those rows exist. That matters
 * because the events are best-effort — a dropped `uploaded` write must not
 * produce a funnel where more people were answered than uploaded, which reads
 * as a bug in the product rather than in the meter.
 *
 * The counts are what makes this a funnel rather than "four counters nobody can
 * turn into rates" — the failure mode this function exists to prevent.
 */
export function funnelCounts(
  visitors: readonly (readonly FunnelStep[])[]
): Record<FunnelStep, number> {
  const counts = Object.fromEntries(FUNNEL_STEPS.map((s) => [s, 0])) as Record<FunnelStep, number>;

  for (const steps of visitors) {
    const deepest = deepestStep(steps);
    if (!deepest) continue;

    const reached = FUNNEL_STEPS.indexOf(deepest);
    for (let i = 0; i <= reached; i++) {
      counts[FUNNEL_STEPS[i]] += 1;
    }
  }

  return counts;
}
