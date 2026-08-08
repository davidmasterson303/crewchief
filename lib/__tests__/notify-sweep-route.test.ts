/**
 * The sweep endpoint cannot be called by anyone who is not the scheduler.
 *
 * @jest-environment node
 *
 * This is the most abusable surface in the product if its authorization is
 * ever wrong — not because it leaks anything, but because it **sends a push
 * notification to every account in the app**. A push cannot be recalled, and
 * the recovery from "CrewChief spammed everyone" is people uninstalling it.
 *
 * So the properties below are pinned in the source rather than trusted to
 * review. Executing the route needs a live Supabase, a service-role key and a
 * push endpoint; what matters is which checks exist and in what order, and
 * that is on disk. Same reasoning as `upload-route-status-codes.test.ts`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const ROUTE = join(ROOT, 'app', 'api', 'internal', 'notify-sweep', 'route.ts');
const SCHEDULER = join(ROOT, 'netlify', 'functions', 'notify-sweep.mts');

/**
 * Source with comments stripped.
 *
 * The fourth time in this repo. This route's docblock explains at length what
 * it refuses and why, and every one of those sentences is a substring that
 * would satisfy an absence assertion written to prove the refusal.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const route = code(readFileSync(ROUTE, 'utf8'));
const scheduler = code(readFileSync(SCHEDULER, 'utf8'));

describe('authorization', () => {
  it('requires a shared secret', () => {
    expect(route).toMatch(/CRON_SECRET/);
    expect(route).toMatch(/x-cron-secret/);
  });

  it('fails closed when the secret is not configured', () => {
    /*
      The direction that matters. The realistic failure is a deploy where the
      variable did not get set, and "unconfigured means open" would turn a
      missing env var into an open relay for push notifications.

      Asserted as a refusal *before* any work: the 503 and the guard both have
      to sit above the first query.
    */
    expect(route).toMatch(/if\s*\(\s*!secret\s*\)/);
    expect(route).toMatch(/status:\s*503/);

    /*
      `.from('` with the quote, not `.from(`. The first draft used the latter
      and matched `Buffer.from(provided)` inside the constant-time comparison —
      reporting that a query ran before the guard when what ran was the guard
      itself. A substring that matches the thing you are measuring against is
      the classic way one of these reads backwards.
    */
    const guardAt = route.indexOf('!secret');
    const firstQueryAt = route.indexOf(".from('");
    expect(guardAt).toBeGreaterThan(-1);
    expect(firstQueryAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(firstQueryAt);
  });

  it('compares the secret in constant time', () => {
    // `===` leaks the secret's prefix through timing. Cheap to close, and this
    // is the only thing between an anonymous caller and every push token.
    expect(route).toMatch(/timingSafeEqual/);
    expect(route).not.toMatch(/provided\s*===\s*expected/);
  });

  it('compares lengths before timingSafeEqual, which throws on a mismatch', () => {
    // An unhandled throw would itself be a timing oracle, and a far louder one
    // than the comparison it was meant to protect.
    const fn = route.slice(route.indexOf('function secretMatches'));
    expect(fn).toMatch(/a\.length\s*!==\s*b\.length/);
  });

  it('rejects without saying why', () => {
    // A probe should not learn whether the secret was absent, short or wrong.
    expect(route).toMatch(/status:\s*401/);
    expect(route).not.toMatch(/wrong secret|invalid secret|secret mismatch/i);
  });

  it('accepts no user credential at all', () => {
    /*
      There is no user. A route that also accepted a session would be one
      compromised account away from letting a real user trigger a global send.
    */
    expect(route).not.toMatch(/requireCaller|authorizeVehicleAccess|createServerActionClient/);
    expect(route).not.toMatch(/\.auth\s*\.\s*getUser\s*\(/);
  });

  it('is a POST, not a GET', () => {
    // A GET is reachable from a link, a prefetch, a crawler and a browser
    // address bar. Nothing that sends notifications should be.
    expect(route).toMatch(/export async function POST/);
    expect(route).not.toMatch(/export async function GET/);
  });
});

describe('the blast radius', () => {
  it('uses the shared cap rather than its own number', () => {
    expect(route).toMatch(/applySendCap/);
  });

  it('applies the cap across the whole run, not per page', () => {
    /*
      A per-page cap would let a runaway through 200 at a time and never report
      itself. Candidates are collected across every page first, so the cap and
      its `capped` flag describe the run.
    */
    /*
      `applySendCap(` with the paren, so this measures the call rather than the
      import that names it — the first draft matched the import line and put
      the cap "before" the loop on every possible arrangement of this file.
    */
    const capAt = route.indexOf('applySendCap(');
    const loopAt = route.indexOf('for (let page');
    expect(loopAt).toBeGreaterThan(-1);
    expect(capAt).toBeGreaterThan(loopAt);
  });

  it('logs at error level when the cap fires', () => {
    // Hitting it means a dedupe stopped working. A warn would sit in a log
    // nobody reads while it happened again the next night.
    const block = route.slice(route.indexOf('summary.capped'));
    expect(block).toMatch(/logger\.error/);
  });

  it('supports a dry run that sends nothing', () => {
    expect(route).toMatch(/dryRun/);
    expect(route).toMatch(/if\s*\(\s*!dryRun\s*\)/);
  });

  it('skips demo vehicles', () => {
    // Seeded fixtures nobody owns, on the portfolio surface, whose data
    // changes for reasons unrelated to any real owner's car.
    expect(route).toMatch(/is_demo/);
  });
});

describe('the dedupe writes', () => {
  it('records a raised recall even when no device was reachable', () => {
    /*
      Someone with no registered device still had the recall raised for them.
      Leaving the row unwritten would re-raise it every night until they
      install the app — and then deliver a months-old backlog at once.

      So the upsert must not sit inside a "was it delivered" branch.
    */
    const block = route.slice(route.indexOf('for (const candidate of recallPlan.send)'));
    const upsertAt = block.indexOf('recall_notifications');
    const deliveredAt = block.indexOf('outcome.delivered');

    expect(upsertAt).toBeGreaterThan(-1);
    expect(upsertAt).toBeLessThan(deliveredAt);
  });

  it('dedupes recalls on the campaign number', () => {
    expect(route).toMatch(/onConflict:\s*'vehicle_id,campaign_number'/);
  });

  it('records the service send against the vehicle', () => {
    expect(route).toMatch(/service_notifications/);
    expect(route).toMatch(/last_notified_at/);
  });
});

describe('the scheduler', () => {
  it('carries a schedule', () => {
    expect(scheduler).toMatch(/schedule:/);
  });

  it('does not run at an hour that would wake anyone', () => {
    /*
      A maintenance reminder is not urgent, and a non-urgent push at a bad hour
      is the one people remember when they turn notifications off. The cron
      hour is UTC; anything from 06:00 to 20:00 UTC keeps it inside daylight
      across the US.
    */
    const match = scheduler.match(/schedule:\s*'(\d+)\s+(\d+)\s/);
    expect(match).not.toBeNull();

    const hourUtc = Number(match![2]);
    expect(hourUtc).toBeGreaterThanOrEqual(6);
    expect(hourUtc).toBeLessThanOrEqual(20);
  });

  it('holds no decision logic of its own', () => {
    /*
      Everything it could contain would live somewhere that runs only in
      production, on a timer, once a day — the worst place in the system to
      debug anything.
    */
    expect(scheduler).not.toMatch(/evaluateSchedule|recallsToRaise|shouldRaiseService/);
    expect(scheduler).not.toMatch(/\.from\(/);
  });

  it('refuses to fire an unauthenticated request', () => {
    // Otherwise it calls a route that correctly refuses it, every day, and the
    // only symptom is a 401 in a log nobody reads.
    expect(scheduler).toMatch(/CRON_SECRET/);
    expect(scheduler).toMatch(/if\s*\(\s*!secret\s*\|\|\s*!site\s*\)/);
  });

  it('takes the site address from the deploy, never from a request', () => {
    /*
      `internal-fetch-posture.test.ts` bans an address derived from an incoming
      request's headers. There is no request here — nothing triggered this but
      the clock — and `URL` is Netlify's deploy-time variable. Pinned so the
      distinction survives someone "modernising" this into a handler that takes
      a request object.
    */
    expect(scheduler).toMatch(/process\.env\.URL/);
    expect(scheduler).not.toMatch(/nextUrl|req\.headers|request\.headers/);
  });
});
