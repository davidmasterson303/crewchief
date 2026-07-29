/**
 * The consultant canary — the half of the gate that actually closes §22.
 *
 * ── Why a promote-time gate is not enough ───────────────────────────────────
 *
 * `CREWCHIEF_ROUNDTRIP_GATE_DESIGN.md` is blunt about this and it is the one
 * thing to take from the whole document: **the §22 outage did not arrive with
 * a deploy.** The key went stale while the code sat still, and the demo was a
 * frozen upload. A promote-time gate only runs when you promote, and nobody
 * was promoting.
 *
 * So this runs on a schedule against the **live demo**, not against a
 * candidate build, and asks the same question the promote gate asks. It is the
 * piece that notices a credential dying on a Tuesday.
 *
 *   node scripts/consultant-canary.mjs                    # the live demo
 *   node scripts/consultant-canary.mjs https://<site>
 *
 * Exit codes are deliberately distinct, so a scheduler can treat them
 * differently:
 *
 *   0  good      — the consultant answered with vehicle-specific facts
 *   1  broken    — ours. Page someone
 *   2  degraded  — Gemini is unavailable. Notice, but do not treat as ours
 *   3  unable    — the canary itself could not run (no secret, unreachable)
 *
 * Conflating 1 and 2 is how a monitor teaches people to ignore it: an alert
 * that fires on someone else's outage gets muted, and a muted alert is worse
 * than none.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(join(here, '..', '.env'), 'utf8')
      .split('\n')
      .find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim() : '';
  } catch {
    return '';
  }
}

const base = (process.argv[2] || 'https://crewchief-demo.davidmasterson.co').replace(/\/$/, '');
const secret = env('CONSULTANT_HEALTH_SECRET');

const stamp = new Date().toISOString();

if (!secret) {
  console.error(`[${stamp}] UNABLE ${base} — CONSULTANT_HEALTH_SECRET is not set`);
  process.exit(3);
}

let health;
try {
  const res = await fetch(`${base}/api/health/consultant`, {
    headers: { 'x-consultant-health-secret': secret },
  });

  if (res.status === 404) {
    /*
      The route 404s for a wrong secret *and* for a build that predates it.
      Distinguishing them from outside is not possible, and guessing would be
      worse than saying so — §22 is the record of confidently guessing at an
      auth failure and being wrong about the mechanism.
    */
    console.error(
      `[${stamp}] UNABLE ${base} — 404. Either the secret is wrong or this build predates the route.`
    );
    process.exit(3);
  }

  health = await res.json();
} catch (error) {
  console.error(`[${stamp}] UNABLE ${base} — ${error.message}`);
  process.exit(3);
}

/*
  A deployment with no CONSULTANT_HEALTH_SECRET reports broken/NOT_CONFIGURED,
  because the route fails closed. That is the route being right and the canary
  being unable — it is not evidence the consultant is dead. Calling it
  `broken` would page someone about a missing env var using the same alert as
  a genuinely dead credential, and an alert that cries wolf gets muted.
*/
if (health.reason === 'NOT_CONFIGURED') {
  console.error(
    `[${stamp}] UNABLE ${base} — the deployment has no CONSULTANT_HEALTH_SECRET set`
  );
  process.exit(3);
}

const line = `[${stamp}] ${health.status.toUpperCase()} ${base} ${health.reason} (${health.ms}ms) — ${health.detail}`;

if (health.status === 'good') {
  console.log(line);
  process.exit(0);
}

console.error(line);
process.exit(health.status === 'degraded' ? 2 : 1);
