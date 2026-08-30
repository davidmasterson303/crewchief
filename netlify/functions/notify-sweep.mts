/**
 * The scheduler. Phase 5, C1 — David's call, 8 Aug.
 *
 * Deliberately the thinnest thing that could work: it holds a time and a
 * secret, and calls the route. Every decision about who gets notified lives in
 * `app/api/internal/notify-sweep/route.ts` and, below that, in
 * `@wellkept/core/notification-sweep` — which is testable without a scheduler,
 * a database, or a deploy.
 *
 * Putting logic here would put it somewhere that only runs in production, on a
 * timer, once a day. That is the worst place in the system to debug anything.
 *
 * ── Why a Netlify scheduled function ────────────────────────────────────────
 *
 * The recommendation Cowork made and David accepted: the deploy path already
 * exists, it costs no new service, and it needs no credentials beyond the ones
 * this site already holds. Scheduled functions do not consume build minutes,
 * and one run a day is a rounding error against any invocation quota.
 *
 * ── Why `process.env.URL` is safe here ──────────────────────────────────────
 *
 * `internal-fetch-posture.test.ts` forbids a route sending credentials to an
 * address derived from an incoming request, because `nextUrl.origin` follows
 * host headers the caller can influence.
 *
 * That rule is about *requests*. There is no request here — nothing triggered
 * this but the clock. `URL` is Netlify's own deploy-time variable for the
 * site's primary address; it is not derived from anything a caller sends,
 * because there is no caller. The distinction is the whole point of the rule,
 * so it is worth writing down rather than leaving the next reader to wonder
 * whether this is the banned shape.
 *
 * ── The hour, chosen rather than defaulted ──────────────────────────────────
 *
 * `@daily` would run at 00:00 UTC, which is 8pm Eastern and 5pm Pacific —
 * survivable, but it drifts toward evening and there is no reason to aim
 * there. 17:00 UTC is 1pm Eastern and 10am Pacific: mid-morning to early
 * afternoon everywhere this product has users.
 *
 * That matters more than it sounds. A maintenance reminder is not urgent, and
 * a non-urgent push that arrives at a bad hour is the one people remember when
 * they turn notifications off. The safest hour is the one nobody notices.
 */

export default async () => {
  const secret = process.env.CRON_SECRET;
  const site = process.env.URL;

  /*
    Both are checked here as well as in the route, and that is not redundancy:
    without them this function would fire a request that the route correctly
    refuses, every day, and the only symptom would be a 401 in a log nobody
    reads. Failing here says which variable is missing.
  */
  if (!secret || !site) {
    console.error(
      '[CRON:SWEEP] Not configured — %s is missing. Sweep skipped.',
      !secret ? 'CRON_SECRET' : 'URL'
    );
    return new Response('Not configured', { status: 503 });
  }

  const response = await fetch(`${site}/api/internal/notify-sweep`, {
    method: 'POST',
    headers: { 'x-cron-secret': secret },
  });

  const body = await response.text();

  if (!response.ok) {
    console.error('[CRON:SWEEP] Sweep failed: %s %s', response.status, body);
    return new Response(body, { status: response.status });
  }

  // Logged on success too. A sweep that sends nothing for a week is either a
  // quiet week or a broken query, and the counts are what tell them apart.
  console.log('[CRON:SWEEP] %s', body);
  return new Response(body, { status: 200 });
};

export const config = {
  // 13:00 Eastern / 10:00 Pacific. See the note above on why not `@daily`.
  schedule: '0 17 * * *',
};
