import { NextResponse } from 'next/server';
import { logger } from '@crewchief/core/logger';
import { requireSession } from '@/lib/api-auth';
import { readVisitorId } from '@/lib/funnel-visitor';
import { recordFunnelStepInBackground } from '@/lib/funnel';
import { claimScansForVisitor } from '@/lib/quote-check';

export const dynamic = 'force-dynamic';

/**
 * Claim the scans this browser made before signing up. Phase 2.97c.
 *
 * The conversion moment, and the only place `saved` can be recorded — without
 * it that step is vocabulary nothing can ever write, and the conversion rate
 * the whole phase is justified on is structurally uncomputable.
 *
 * ── The visitor id comes from the cookie, never from the caller ─────────────
 *
 * `readVisitorId` reads the **httpOnly** `cc_fv` cookie, which no browser
 * script can read or forge. Accepting an id from a request body instead would
 * let any authenticated user claim any visitor's scan by replaying an id, and
 * ids are visible in the database and in logs. This is the whole authorization
 * story for the rows being moved, so it is not a detail.
 *
 * ── Idempotent, because it is called more than once ─────────────────────────
 *
 * Both signup paths call it — the immediate-session one and the return through
 * `/auth/callback` after email verification — and a user may refresh either.
 * `claimScansForVisitor` only touches rows where `claimed_by IS NULL`, so a
 * second call moves nothing and reports zero. `saved` is recorded only when
 * something actually moved, so a refresh cannot inflate the conversion count.
 *
 * ── Authenticated, unlike everything else on this path ──────────────────────
 *
 * The rest of the front door is deliberately anonymous. This endpoint is the
 * seam where an anonymous session becomes an account, so it is the one part
 * that must know who is asking.
 */
export async function POST(): Promise<Response> {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const visitorId = readVisitorId();

  /*
    No cookie is an ordinary outcome, not an error: they signed up on a
    different device, or more than 24 hours after the scan, or never used the
    front door at all — most signups will not have one. Reported as success
    with nothing claimed, because from the caller's point of view nothing went
    wrong.
  */
  if (!visitorId) {
    return NextResponse.json({ success: true, claimed: 0 });
  }

  try {
    const claimed = await claimScansForVisitor(visitorId, auth.userId);

    if (claimed > 0) {
      // Only on a real move. A signup with no scan behind it is not a
      // front-door conversion, and counting it would inflate the single number
      // this phase exists to produce.
      recordFunnelStepInBackground({ visitorId, step: 'saved' });
      logger.info('FRONT_DOOR:CLAIMED', 'Scans claimed into a new account', { claimed });
    }

    return NextResponse.json({ success: true, claimed });
  } catch (err) {
    /*
      Unlike the anonymous path, this failure is worth reporting: the user asked
      for this and would otherwise see an account with their scan missing and no
      explanation. The message is generic — the underlying one can carry
      database detail and this reply goes to a browser.
    */
    logger.warn('FRONT_DOOR:CLAIM_FAILED', 'Could not claim scans', {
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'Could not attach your saved check.' },
      { status: 500 }
    );
  }
}
