import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@crewchief/core/logger';
import { MAX_FILE_SIZE } from '@crewchief/core/validation';
import { decideFrontDoorGate } from '@crewchief/core/front-door';
import { describeQuote } from '@crewchief/core/advice-range';
import { visitorCookieOptions, VISITOR_COOKIE } from '@crewchief/core/funnel';
import { checkFrontDoorBudget } from '@/lib/ai-budget';
import { checkRateLimit } from '@/lib/rate-limit';
import { platformClientIp } from '@crewchief/core/client-ip';
import { resolveVisitor } from '@/lib/funnel-visitor';
import { recordFunnelStepInBackground } from '@/lib/funnel';
import { runQuoteCheck } from '@/lib/quote-check';

export const dynamic = 'force-dynamic';

/**
 * The anonymous front door. Phase 2.97b — no account, no VIN, no dossier.
 *
 * ── The order is the security posture, and it is not local to this file ─────
 *
 * `decideFrontDoorGate` owns it, with tests on the ordering itself, because
 * erratum T1's finding was a *reorder* rather than a missing control — and an
 * ordering is the property that survives review and dies in a handler where
 * every check is individually present. This route supplies inputs and renders
 * the verdict; it does not decide.
 *
 * ── D6: no dossier generation on this path, ever ────────────────────────────
 *
 * A $0.118 Pro dossier firing for anonymous traffic is the most expensive
 * single mistake this surface could make. Nothing here reaches it, and
 * `front-door-gate.test.ts` asserts the absence across every module on the
 * path rather than trusting this comment.
 *
 * ── Why the funnel writes sit where they do ─────────────────────────────────
 *
 * `uploaded` fires after the gate and before the model call, so it counts
 * people who actually got as far as spending money. `answered` fires only on a
 * usable answer — a rejected upload is not an answer, and counting it would
 * inflate the step the conversion rate divides by. Both are fire-and-forget and
 * cannot fail the request. `landed` is not here: it belongs to the page render
 * and needs middleware, since `cookies()` is read-only during a Server
 * Component render.
 */
export async function POST(request: NextRequest): Promise<Response> {
  // Read-or-issue. A Route Handler *can* set a cookie, unlike a Server
  // Component, so the POST path does not depend on middleware being wired.
  const visitor = resolveVisitor(request);
  const visitorId = visitor.visitorId;

  const budget = await checkFrontDoorBudget();

  /*
    The bucket is only consulted when the door is open, so a closed door does
    not also consume someone's rate-limit budget. A null address means the
    platform did not supply one — the bucket does not apply, rather than
    everyone sharing one called 'unknown'.
  */
  let rateLimited = false;
  let retryAfterSeconds: number | undefined;

  if (budget.allowed) {
    const ip = platformClientIp((name) => request.headers.get(name));
    if (ip) {
      const limit = await checkRateLimit(`frontdoor:${ip}`, 'ai');
      rateLimited = !limit.allowed;
      retryAfterSeconds = limit.retryAfterSeconds;
    }
  }

  const gate = decideFrontDoorGate({ budget, rateLimited, retryAfterSeconds, visitorId });

  if (!gate.allow) {
    logger.warn('FRONT_DOOR:REFUSED', 'Front door refused a request', { refusal: gate.refusal });
    const refused = NextResponse.json(
      { success: false, message: gate.message },
      {
        status: gate.status,
        headers: gate.retryAfterSeconds
          ? { 'Retry-After': String(gate.retryAfterSeconds) }
          : undefined,
      }
    );
    return withVisitorCookie(refused, visitor);
  }

  let fileBase64: string | undefined;
  let mimeType: string | undefined;
  let text: string | undefined;

  try {
    const form = await request.formData();
    const file = form.get('file');
    const pasted = form.get('text');

    if (file && typeof file !== 'string') {
      if (file.size > MAX_FILE_SIZE) {
        return withVisitorCookie(
          NextResponse.json(
            {
              success: false,
              message: `That image is larger than ${MAX_FILE_SIZE / 1024 / 1024}MB. A photo taken in your camera app is usually fine.`,
            },
            { status: 413 }
          ),
          visitor
        );
      }
      mimeType = file.type;
      fileBase64 = Buffer.from(await file.arrayBuffer()).toString('base64');
    }

    if (typeof pasted === 'string' && pasted.trim()) {
      // Bounded before it reaches a prompt: pasted text is the cheapest way to
      // inflate an input-token bill on a surface nobody had to sign up for.
      text = pasted.slice(0, 8000);
    }
  } catch {
    return withVisitorCookie(
      NextResponse.json({ success: false, message: 'That upload could not be read.' }, { status: 400 }),
      visitor
    );
  }

  if (!fileBase64 && !text) {
    return withVisitorCookie(
      NextResponse.json(
        { success: false, message: 'Add a photo of the estimate, or paste its text.' },
        { status: 400 }
      ),
      visitor
    );
  }

  if (visitorId) recordFunnelStepInBackground({ visitorId, step: 'uploaded' });

  const result = await runQuoteCheck({ fileBase64, mimeType, text });

  if (!result.ok) {
    // Not an `answered` event. A refusal is not an answer, and counting it
    // would inflate the denominator every later rate divides by.
    logger.info('FRONT_DOOR:NOT_A_QUOTE', 'Quote check rejected an upload', { reason: result.reason });
    return withVisitorCookie(
      NextResponse.json({ success: false, message: result.message }, { status: 422 }),
      visitor
    );
  }

  if (visitorId) recordFunnelStepInBackground({ visitorId, step: 'answered' });

  const { check } = result;

  /*
    B3. The answer is a range and a position, never a verdict — the liability
    posture, the credibility posture and the truthful one at the same time. The
    sentence is composed in `describeQuote` so this route cannot drift into
    writing its own copy.
  */
  const answer = check.quotedTotal
    ? describeQuote({
        quoted: check.quotedTotal,
        range: check.typical,
        job: check.jobSummary,
      })
    : null;

  return withVisitorCookie(
    NextResponse.json({
      success: true,
      job: check.jobSummary,
      vehicle: check.vehicle,
      quotedTotal: check.quotedTotal,
      typical: check.typical,
      answer,
    }),
    visitor
  );
}

/**
 * Attach the visitor cookie when one was issued.
 *
 * On every response including refusals: a visitor turned away by the daily
 * ceiling who comes back tomorrow should be the same visitor, or the funnel
 * counts them twice and the return rate is invented.
 */
function withVisitorCookie(
  response: NextResponse,
  visitor: { visitorId: string | null; issue: boolean }
): NextResponse {
  if (visitor.issue && visitor.visitorId) {
    response.cookies.set(
      VISITOR_COOKIE,
      visitor.visitorId,
      visitorCookieOptions(process.env.NODE_ENV === 'production')
    );
  }
  return response;
}
