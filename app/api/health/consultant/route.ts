import { NextResponse, type NextRequest } from 'next/server';
import { genAI, flashConfig } from '@/lib/gemini';
import { getServerClient } from '@/lib/supabase';
import { logger } from '@crewchief/core/logger';
import { withTimeout, TimeoutError } from '@crewchief/core/retry';
import { CONSULTANT_ROUND_TRIP } from '@crewchief/core/demo-contract';
import {
  classifyRoundTrip,
  isRetryable,
  type ConsultantHealth,
} from '@crewchief/core/consultant-health';

export const dynamic = 'force-dynamic';

/**
 * Does the consultant actually answer? — the round-trip gate.
 *
 * ── Why /api/health/ai is not enough ────────────────────────────────────────
 *
 * That route lists models. It proves the credential is accepted, which is the
 * half of §25 that could be checked without spending anything. It cannot prove
 * the consultant *answers*, and the outage it was built for had two causes: a
 * stale key **and** a 403 from our own authorization. A credential check sees
 * only the first.
 *
 * So this asks a real question about a real demo vehicle and reads the answer.
 *
 * ── Why it is behind a shared secret ────────────────────────────────────────
 *
 * `CREWCHIEF_ROUNDTRIP_GATE_DESIGN.md`, decision 1: **close the endpoint
 * rather than making the prompt cheap.** A public endpoint that spends Gemini
 * tokens on request is the unbounded-cost bug §3 already records in
 * `performance-stats`, where demo vehicles fell through to a model call on
 * every anonymous page view. Cost stops being a design problem the moment the
 * caller has to authenticate.
 *
 * The secret is compared in constant time and never echoed. Absent config
 * fails closed: no `CONSULTANT_HEALTH_SECRET` means nobody can run this, which
 * is the safe direction for a route that spends money.
 *
 * ── Why it is not under /api/v1 ─────────────────────────────────────────────
 *
 * Decision 3, and the same reasoning that kept `/api/version` and
 * `/api/health/ai` unversioned in task 2.2: release tooling pins these by
 * path, and versioning them couples the deploy pipeline to the evolution of a
 * product API. Created here so it never has to be moved.
 */

/** One attempt's ceiling. The consultant is a chat call, not a research call. */
const ROUND_TRIP_TIMEOUT_MS = 25_000;

function timingSafeEqual(a: string, b: string): boolean {
  // Same length check first would leak length, so compare over the max and
  // fold length into the result.
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

async function attemptRoundTrip(): Promise<ConsultantHealth> {
  const client = getServerClient();

  const [{ data: vehicle }, { data: knowledge }] = await Promise.all([
    client.from('vehicles').select('*').eq('id', CONSULTANT_ROUND_TRIP.vehicleId).maybeSingle(),
    client
      .from('vehicle_knowledge_base')
      .select('*')
      .eq('vehicle_id', CONSULTANT_ROUND_TRIP.vehicleId)
      .maybeSingle(),
  ]);

  if (!vehicle) {
    // Ours: the seed is missing or the anon read is broken. Both block.
    return {
      status: 'broken',
      reason: 'DEMO_VEHICLE_MISSING',
      detail: `The demo vehicle ${CONSULTANT_ROUND_TRIP.vehicleId} could not be read anonymously.`,
    };
  }

  /*
    The grounding the demo consultant actually receives, per §22's related
    finding: the knowledge base and recall data. Anchoring the expected tokens
    on facts from that data is what makes them answerable rather than hopeful.
  */
  const prompt = [
    `You are an automotive consultant answering about a specific vehicle.`,
    `Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim ?? ''}`.trim(),
    `Current mileage: ${vehicle.current_mileage}`,
    `Owner's stated objective: ${vehicle.ownership_objective ?? 'unknown'}`,
    knowledge?.known_issues ? `Known issues: ${JSON.stringify(knowledge.known_issues)}` : '',
    ``,
    `Question: ${CONSULTANT_ROUND_TRIP.question}`,
    `Answer concisely and cite the specific mileage and modifications above.`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const response = await withTimeout(
      () =>
        genAI.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: flashConfig,
        }),
      ROUND_TRIP_TIMEOUT_MS,
      'consultant round trip'
    );

    return classifyRoundTrip(
      { httpStatus: 200, answer: response.text ?? '' },
      CONSULTANT_ROUND_TRIP.expectedTokens
    );
  } catch (error) {
    if (error instanceof TimeoutError) {
      return classifyRoundTrip({ httpStatus: 0, timedOut: true }, CONSULTANT_ROUND_TRIP.expectedTokens);
    }

    /*
      Google's SDK surfaces status and message inconsistently, so both are
      handed to the classifier and it decides. Deliberately not parsed here —
      keeping the classification in one pure, tested place is the whole point
      of `classifyRoundTrip`.
    */
    const message = error instanceof Error ? error.message : String(error);
    const statusMatch = /\b(4\d{2}|5\d{2})\b/.exec(message);
    return classifyRoundTrip(
      { httpStatus: statusMatch ? Number(statusMatch[1]) : 500, errorText: message },
      CONSULTANT_ROUND_TRIP.expectedTokens
    );
  }
}

export async function GET(request: NextRequest) {
  const secret = process.env.CONSULTANT_HEALTH_SECRET;

  if (!secret) {
    // Fail closed. An unset secret must not mean "open" on a route that spends
    // money on every call.
    return NextResponse.json(
      { status: 'broken', reason: 'NOT_CONFIGURED', detail: 'CONSULTANT_HEALTH_SECRET is not set.' },
      { status: 503 }
    );
  }

  const presented = request.headers.get('x-consultant-health-secret') ?? '';
  if (!timingSafeEqual(presented, secret)) {
    // 404 rather than 401: an unauthenticated caller should not learn that a
    // token-spending endpoint exists here at all.
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const startedAt = Date.now();
  let health = await attemptRoundTrip();

  /*
    One retry, degraded only. Never retry a `broken` — a 403 from our own
    authorization returns the same 403 the second time, and retrying only
    makes the log ambiguous about whether something intermittent happened.
  */
  if (isRetryable(health.status)) {
    await new Promise((r) => setTimeout(r, 3000));
    health = await attemptRoundTrip();
  }

  const body = { ...health, ms: Date.now() - startedAt };

  if (health.status === 'good') {
    logger.info('HEALTH_CONSULTANT:OK', health.detail, { ms: body.ms });
  } else {
    logger.error('HEALTH_CONSULTANT:' + health.status.toUpperCase(), new Error(health.reason), {
      detail: health.detail,
      ms: body.ms,
    });
  }

  // 200 carries the verdict; the caller branches on `status`, never on the
  // HTTP code. A gate that reads an HTTP status as a verdict is how §25's
  // "the page returned 200" became proof of a working feature.
  return NextResponse.json(body);
}
