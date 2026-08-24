import { NextResponse } from 'next/server';

/**
 * Reports whether this deployment's Gemini credential actually works.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The AI consultant — the demo's headline feature, advertised on the portfolio
 * as live — was dead in production and **passed every gate this project has**.
 * `verify-demo.mjs` checked that `/consultant/<id>` returned 200 and that the
 * tables were anon-readable; the promote gate ran that check and promoted
 * happily. A page that loads and a feature that works are different claims, and
 * only the first was ever tested.
 *
 * It was down for two independent reasons, and this route is aimed at the
 * second: the deploy environment held a **stale API key** from the right
 * project. Nothing in the build, the typecheck, the test suite or the demo
 * contract could see that, because the key is only exercised at request time
 * against Google.
 *
 * (The first reason — a 403 from our own authorization — is guarded by a unit
 * test in `lib/__tests__/auth-posture.test.ts` instead, since it needs no
 * network.)
 *
 * ── Why it lists models instead of asking a question ────────────────────────
 *
 * The obvious design is to send a real prompt and check for an answer. That
 * would be a **public endpoint that spends tokens on request**, which is
 * exactly the unbounded-cost bug this codebase already shipped once in
 * `performance-stats`: demo vehicles fell through to a Gemini call *and* a write
 * on every anonymous page view.
 *
 * Listing models is a metadata call. It generates nothing, costs nothing, takes
 * no user input, and still distinguishes the three states that matter:
 * credential missing, credential rejected, credential good. A stale key fails
 * it exactly the way it failed the consultant.
 *
 * It calls the REST endpoint directly rather than through `@google/genai`
 * because the SDK exposes only `listInternal` on the models prototype — no
 * documented public `list()` — and a health check should not depend on an
 * internal.
 *
 * ── What it deliberately does not return ────────────────────────────────────
 *
 * No key, no prefix, no length, no fragment. `reason` carries Google's own
 * status text, which is safe: it describes the rejection, not the secret. The
 * point is to tell a deploy script "the credential works" without telling a
 * reader anything they could use.
 *
 * ── Why it also names the models (30 Jul) ───────────────────────────────────
 *
 * It was already fetching the list and throwing all but the length away.
 *
 * The models this application uses are chosen per call site, and the
 * identifiers are versioned strings that are not guessable — a wrong one fails
 * at call time, in production, on a path a typecheck cannot see. Choosing them
 * from release notes is guessing; choosing them from the list this deployment's
 * own credential can see is not. See
 * `TICKET_gemini_model_tiering_2026-07-30.md`.
 *
 * `models` stays a count, because `verify-demo.mjs` prints it as one and a
 * health check should not break its own consumer to add a field. Names arrive
 * beside it as `modelNames`.
 *
 * This discloses nothing: the model catalogue is public documentation, and
 * which models a key can reach says nothing about the key. It remains a
 * metadata call that generates nothing and takes no user input.
 *
 * ── The 60s cache is load-bearing ──────────────────────────────────────────
 *
 * Deliberately no database rate limiter: a health check that fails because the
 * database is slow reports the wrong outage. An in-memory TTL per instance
 * bounds how often this can reach Google no matter how often it is polled, and
 * needs nothing to be up but the process itself.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_TTL_MS = 60_000;
let cached: { at: number; status: number; body: Record<string, unknown> } | null = null;

/**
 * Constant-time string compare, so a wrong secret cannot be found a byte at a
 * time. Copied in shape from `/api/health/consultant`, which is the sibling
 * this route should have matched from the start.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function GET(request: Request) {
  const noStore = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  };

  /*
    ── ⚠ PERF-05 · this was public, unrated, and shared the production key ────

    Confirmed live on 23 Aug: **200, unauthenticated, returning 50 Gemini model
    names.** Three things wrong at once, and the second is the expensive one.

    **It cannot be cached at the edge.** `force-dynamic` plus `no-store` means
    the CDN never answers one, so *every request is a function invocation*. At
    10 req/s from a single laptop that is ~25.9M invocations a month — roughly
    **$600** on Netlify's public list pricing, for an endpoint nobody is
    supposed to call.

    **The 60-second cache is `let cached` at module scope, which is per warm
    Lambda instance.** A burst produces N cold instances, each with an empty
    cache, each making a real call to `generativelanguage.googleapis.com` with
    the **production `GEMINI_API_KEY`** — the same key the consultant, the
    invoice extractor and the dossier generator use. Google's quotas are
    per-project, so exhausting them here takes the product down.

    **And it is a credential-validity oracle**: 200 means the key works, 503
    means it was rotated.

    The right pattern was one file away. `/api/health/consultant` is secret-gated
    and `auth-posture.test.ts` asserts the gate. This route's only two callers —
    `promote-demo.mjs`, and a person choosing model identifiers — can both send
    a header.

    ⚠ **Fails closed on an unset secret**, exactly as the consultant one does: no
    `AI_HEALTH_SECRET` means nobody can run this. An unset secret that meant
    "open to everyone" would restore the finding the first time somebody
    deployed without it.
  */
  const secret = process.env.AI_HEALTH_SECRET || process.env.CONSULTANT_HEALTH_SECRET || '';

  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        reason: 'NOT_CONFIGURED',
        detail: 'AI_HEALTH_SECRET is not set, so this check cannot be run.',
      },
      { status: 503, headers: noStore }
    );
  }

  if (!timingSafeEqual(request.headers.get('x-ai-health-secret') ?? '', secret)) {
    /*
      404, not 401. A 401 confirms the endpoint exists and is worth attacking;
      this route's whole problem was being findable, and the two callers that
      matter both know the header.
    */
    return NextResponse.json({ ok: false, reason: 'NOT_FOUND' }, { status: 404, headers: noStore });
  }

  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...cached.body, cached: true }, { status: cached.status, headers: noStore });
  }

  const key = process.env.GEMINI_API_KEY || '';

  // Distinguished from "rejected" on purpose: an unset variable and a stale one
  // are different failures with different fixes.
  if (!key) {
    cached = { at: Date.now(), status: 503, body: { ok: false, reason: 'GEMINI_API_KEY is not set' } };
    return NextResponse.json({ ...cached.body, cached: false }, { status: 503, headers: noStore });
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      { cache: 'no-store' }
    );

    if (!res.ok) {
      let reason = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        // Google's own message. Describes the rejection, never the credential.
        if (err?.error?.status) reason = `${err.error.status} (HTTP ${res.status})`;
      } catch {
        /* keep the plain status */
      }
      cached = { at: Date.now(), status: 503, body: { ok: false, reason } };
      return NextResponse.json({ ...cached.body, cached: false }, { status: 503, headers: noStore });
    }

    const data = await res.json();
    const list = Array.isArray(data?.models) ? data.models : [];

    /*
      Google returns fully-qualified names — `models/gemini-2.5-flash`. The
      application uses the bare identifier, so strip the prefix here rather
      than making every reader remember to. Sorted so two deployments are
      diffable.
    */
    const modelNames = list
      .map((m: { name?: unknown }) => (typeof m?.name === 'string' ? m.name.replace(/^models\//, '') : null))
      .filter((n: string | null): n is string => !!n)
      .sort();

    cached = {
      at: Date.now(),
      status: 200,
      body: { ok: true, models: list.length, modelNames },
    };
    return NextResponse.json({ ...cached.body, cached: false }, { status: 200, headers: noStore });
  } catch (error) {
    cached = {
      at: Date.now(),
      status: 503,
      body: { ok: false, reason: error instanceof Error ? error.message : 'unreachable' },
    };
    return NextResponse.json({ ...cached.body, cached: false }, { status: 503, headers: noStore });
  }
}
