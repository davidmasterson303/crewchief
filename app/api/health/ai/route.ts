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

export async function GET() {
  const noStore = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  };

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
    const models = Array.isArray(data?.models) ? data.models.length : 0;
    cached = { at: Date.now(), status: 200, body: { ok: true, models } };
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
