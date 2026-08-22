/**
 * Which framing a deployed page is serving, read from its HTML.
 *
 * ── Why this is not inline in the promote script ────────────────────────────
 *
 * Same argument as `run-outcome.mjs`: behaviour that lives inside a
 * verification script cannot be established by running that script against a
 * healthy target. Proving this check fires required repointing the demo URL at
 * the product host — which works, and is not a test anybody will run twice.
 *
 * ── What it is deciding ─────────────────────────────────────────────────────
 *
 * `CREWCHIEF_DEMO_SITE` is a per-site Netlify variable. Since 22 Aug both the
 * demo masthead and the landing call to action are gated on it, and its
 * default is **product** — chosen so an unset variable can never put demo
 * framing on the App Store listing's URL.
 *
 * ⚠ The cost of that safe direction lands on the other host: a demo site whose
 * variable goes missing does not break. It quietly starts asking recruiters to
 * sign up, with no error anywhere. This is what makes that visible.
 */

/** The masthead, gated directly on the variable in `app/layout.tsx`. */
const DEMO_MASTHEAD = 'Shared demo garage';

/** The two calls to action, gated on the same value via `SiteRoleProvider`. */
const DEMO_CTA = 'Enter demo';
const PRODUCT_CTA = 'Add your vehicle';

/**
 * `'demo'`, `'product'`, or `'unknown'` when neither framing is recognisable.
 *
 * ⚠ `product` wins over `demo` when both appear. A page showing the product
 * CTA is asking somebody to sign up whatever else is on it, and that is the
 * outcome worth refusing — reporting `demo` because a stale masthead survived
 * would be the reassuring reading of contradictory evidence.
 *
 * ⚠ `unknown` is not `demo`. Both strings are copy and copy changes; a check
 * that treated "I cannot tell" as "fine" would retire itself the first time
 * somebody reworded the masthead, and nothing would say so.
 */
export function siteFraming(html) {
  if (typeof html !== 'string' || html === '') return 'unknown';

  if (html.includes(PRODUCT_CTA)) return 'product';
  if (html.includes(DEMO_MASTHEAD) || html.includes(DEMO_CTA)) return 'demo';

  return 'unknown';
}

/** How many independent signals agreed, so a one-signal pass can say so. */
export function demoSignals(html) {
  if (typeof html !== 'string') return 0;
  return [DEMO_MASTHEAD, DEMO_CTA].filter((s) => html.includes(s)).length;
}
