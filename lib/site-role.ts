/**
 * Which of the two CrewChief sites this build is.
 *
 * One codebase, two Netlify projects, two hostnames:
 *
 *   crewchief.davidmasterson.co        web-live    the product. App Store
 *                                                  listing URL, and the origin
 *                                                  every installed app calls
 *   crewchief-demo.davidmasterson.co   demo-live   the portfolio piece
 *
 * Until 20 Aug nothing in the application knew the difference, and that was
 * fine while there was only one site — which there was, and it was the demo.
 * The 17 Aug hostname split made it wrong on one of the two and nothing
 * announced the change: `DemoBanner` kept rendering unconditionally, so the URL
 * App Review reads carried a **"PORTFOLIO DEMO · Shared demo garage"** masthead
 * above the privacy policy.
 *
 * ── ⚠ Unset means "the product", and that direction is the whole point ──────
 *
 * The variable enables the demo framing rather than disabling it, so a missing
 * or misspelled value degrades toward *the product site being unbranded as a
 * demo* — never toward the App Store's hostname claiming to be one.
 *
 * The two failures are not symmetrical, which is why this is not a coin toss:
 *
 *   forgotten on the demo    the portfolio piece loses its byline. Cosmetic,
 *                            and David looks at that page — he would notice
 *                            within a day.
 *   forgotten on the product Apple reads a privacy policy under a masthead
 *                            calling the service a demo. Invisible to us, and
 *                            discovered by a reviewer.
 *
 * Same rule as `CRON_SECRET` refusing to run unconfigured and
 * `verifyAppleSignedPayload` refusing an empty trust anchor: the unconfigured
 * state must be the safe one, because the realistic mistake is a deploy that
 * missed a variable.
 *
 * It also means **only one site needs configuring**, which sidesteps
 * `CLAUDE.md` §7 entirely — there is no second place to forget.
 *
 * ── Read on the server, and read at build time for static routes ────────────
 *
 * `app/layout.tsx` is a server component, so this never reaches the client
 * bundle and needs no `NEXT_PUBLIC_` prefix. For statically generated routes
 * Next resolves it during the build rather than per request — which is correct
 * here, because the two sites build separately with their own environments, but
 * it does mean **changing the value requires a redeploy, not a restart**.
 */

/** The literal that enables the demo framing. Nothing else does. */
const ENABLED = 'true';

/**
 * Whether this build should present itself as the portfolio demo.
 *
 * Takes the value rather than reading `process.env` so the rule is testable
 * without mutating the environment — the same shape as `readPinnedRoots`.
 *
 * Only the exact string `'true'` enables it. `'false'`, `'0'`, `'no'`, `''` and
 * anything else resolve to the product site, deliberately: a variable someone
 * set to `false` meaning to switch the banner off must not switch it on because
 * a non-empty string looked truthy.
 */
export function isDemoSite(value: string | undefined | null): boolean {
  return value?.trim().toLowerCase() === ENABLED;
}
