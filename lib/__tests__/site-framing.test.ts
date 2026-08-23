/**
 * Telling the demo host from the product host, from what it serves.
 *
 * @jest-environment node
 *
 * ── Why this is a pure function with a test ─────────────────────────────────
 *
 * Same argument as `run-outcome.test.ts`: the behaviour lives inside a promote
 * script, so running that script against a healthy target proves nothing about
 * what it would do against a sick one. Confirming the check fired at all
 * required temporarily repointing the demo URL at the product host — which
 * works once and is not a test anybody runs twice.
 *
 * ── What it is guarding ─────────────────────────────────────────────────────
 *
 * `CREWCHIEF_DEMO_SITE` is a per-site Netlify variable. Since 22 Aug the demo
 * masthead **and** the landing call to action are both gated on it, and its
 * default is product — chosen so an unset variable can never put demo framing
 * on the App Store listing's URL, which is the failure that actually happened
 * with the masthead on 20 Aug.
 *
 * ⚠ The cost of that safe direction lands on the other host. A demo site whose
 * variable goes missing does not break, error or look wrong: it quietly starts
 * asking recruiters to **sign up**. `promote-demo` now refuses rather than
 * shipping that, and this pins the decision it refuses on.
 */

import { demoSignals, siteFraming } from '../../scripts/lib/site-framing.mjs';

const DEMO_PAGE = '<html><body><div>Shared demo garage</div><button>Enter demo</button></body></html>';
const PRODUCT_PAGE =
  '<html><body><a href="/signup">Add your vehicle</a><button>See a sample garage</button></body></html>';

describe('reading a deployed page', () => {
  it('recognises the demo host', () => {
    expect(siteFraming(DEMO_PAGE)).toBe('demo');
  });

  it('recognises the product host', () => {
    expect(siteFraming(PRODUCT_PAGE)).toBe('product');
  });

  it('counts both demo signals, so a one-signal pass can say so', () => {
    /*
      Two independent gates on the same variable — the masthead in the layout
      and the CTA through `SiteRoleProvider`. If only one survives a copy
      change the check still passes, and says which.
    */
    expect(demoSignals(DEMO_PAGE)).toBe(2);
    expect(demoSignals('<html>Enter demo</html>')).toBe(1);
  });
});

describe('the directions that matter', () => {
  it('calls a page product when both framings appear', () => {
    /*
      ⚠ A page showing the product CTA is asking somebody to sign up whatever
      else is on it. Reporting "demo" because a stale masthead survived would
      be the reassuring reading of contradictory evidence, and the whole point
      of the check is to refuse that outcome.
    */
    expect(siteFraming(DEMO_PAGE + PRODUCT_PAGE)).toBe('product');
  });

  it('does not treat "cannot tell" as fine', () => {
    /*
      ⚠ `unknown` is not `demo`. Both signals are copy, and copy changes. A
      check that read silence as a pass would retire itself the first time
      somebody reworded the masthead, and nothing would announce it — the exact
      failure mode CLAUDE.md §5 keeps finding in this repo's own instruments.
    */
    expect(siteFraming('<html><body>Something else entirely</body></html>')).toBe('unknown');
  });

  it('treats an empty or absent body as unknown rather than either site', () => {
    // A failed fetch must not resolve to a verdict about configuration.
    expect(siteFraming('')).toBe('unknown');
    expect(siteFraming(undefined as unknown as string)).toBe('unknown');
    expect(siteFraming(null as unknown as string)).toBe('unknown');
  });
});

describe('the strings it depends on are the ones that ship', () => {
  it('matches the CTA the landing hero renders', () => {
    /*
      Anti-vacuous, and the way this check rots: the module hardcodes copy, and
      copy lives somewhere else. Read from the component so a rename fails here
      instead of silently making the promote gate unfalsifiable.
    */
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');

    const hero = readFileSync(join(__dirname, '..', '..', 'components', 'LandingHero.tsx'), 'utf8');

    expect(hero).toContain('Add your vehicle');
    expect(hero).toContain('Enter demo');
  });
});
