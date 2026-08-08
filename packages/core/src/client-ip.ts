/**
 * Which client IP a rate limit may be keyed on, and which must never be.
 *
 * Phase 2.97a, erratum **T1**. Pure — the caller passes a header lookup.
 *
 * ── The rule, and why it is not the obvious one ─────────────────────────────
 *
 * `cc-tech-0003` at **high** confidence: no request-derived value the caller
 * influences may be trusted, and the offending hop was deleted rather than made
 * safe. `X-Forwarded-For` is a request header. Anyone can send one. A bucket
 * keyed on it is not a weak control, it is a **decorative** one — an attacker
 * writes a new value per request and every request lands in a fresh bucket, so
 * the limiter counts to one forever while reporting that it is working.
 *
 * That is the vacuous-check shape this codebase keeps finding in its own
 * instruments, and on an unauthenticated endpoint that spends money per call it
 * is the expensive version.
 *
 * ── What is safe is not "a header", it is "a header the edge overwrites" ────
 *
 * The distinction is not the transport. `X-Forwarded-For` is appended to, so a
 * caller-supplied value survives in it. `X-Nf-Client-Connection-Ip` is *set* by
 * Netlify's edge from the TCP peer address on every request, discarding
 * whatever arrived — so the value is the platform's observation, not the
 * caller's assertion.
 *
 * **This is a trust assumption about the host, and it is the load-bearing one
 * here.** It holds only while this app is served by Netlify and only for
 * traffic that actually transits its edge. If the deployment target changes,
 * this list is the thing to revisit, and a wrong entry fails silently in the
 * attacker's favour. Hence the shape below: an explicit allowlist with the
 * reason attached, rather than a chain of fallbacks.
 *
 * ── There is deliberately no fallback to a spoofable header ─────────────────
 *
 * The tempting last resort — "use `X-Forwarded-For` if the platform header is
 * missing" — reintroduces the whole problem, because an attacker can *cause*
 * the platform header to be missing by not being behind the edge. Absence
 * returns `null`, and the caller decides. For the front door that means the
 * per-IP bucket does not apply and the spend ceiling carries the request alone,
 * which is the correct division: the ceiling is the primary control precisely
 * because it does not depend on identifying anyone.
 */

/**
 * Headers whose value the platform sets rather than forwards, in order.
 *
 * One entry today. It is a list rather than a constant so adding a second host
 * is an edit here with a reason beside it, instead of an `||` somewhere in a
 * route handler.
 */
export const PLATFORM_IP_HEADERS = [
  // Netlify sets this at the edge from the connection's peer address on every
  // request, overwriting anything the caller sent.
  'x-nf-client-connection-ip',
] as const;

/**
 * Headers that look like an answer and are not. Never read these for a limit.
 *
 * Exported so a test can assert no rate-limit path reads one, rather than the
 * rule living only in a comment that the next author does not open.
 */
export const SPOOFABLE_IP_HEADERS = [
  'x-forwarded-for',
  'x-real-ip',
  'forwarded',
  'client-ip',
  'x-client-ip',
] as const;

/**
 * The client IP, or `null` when the platform did not supply one.
 *
 * `null` is a real answer and not a failure — see the header note. Callers must
 * handle it rather than substituting a constant, because keying every
 * unidentifiable request on the same string ('unknown') builds one shared
 * bucket that the first bot exhausts for every genuine visitor behind it.
 */
export function platformClientIp(header: (name: string) => string | null | undefined): string | null {
  for (const name of PLATFORM_IP_HEADERS) {
    const value = header(name)?.trim();
    if (!value) continue;

    /*
      Take the first entry if a comma-separated list ever appears. Netlify sends
      a single address, so this is defensive rather than expected — but the
      failure it prevents is the whole list becoming one bucket key, which would
      make the limit trivially evadable by adding a second value.
    */
    const first = value.split(',')[0].trim();
    if (first) return first;
  }

  return null;
}
