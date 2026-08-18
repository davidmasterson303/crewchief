/**
 * The two documents that make promises the rest of the product has to keep.
 *
 * @jest-environment node
 *
 * A privacy policy is not prose. It is a set of factual claims about what the
 * software does, published at a URL Apple requires and a reviewer will open —
 * and every one of those claims can be falsified by a later commit that nobody
 * connects to a legal page. That is the failure this file exists to catch: not
 * a typo, but the day someone adds an analytics SDK and the policy quietly
 * becomes untrue.
 *
 * ── Why these are source assertions rather than rendered ones ───────────────
 *
 * `text-contrast-floor.test.ts` already reads these files as markup and holds
 * the AA floor on them, and the pages are server components whose value is
 * their *content*. Rendering them would prove React works. Reading them proves
 * the claims are still there.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SUBSCRIPTION_CANCEL_PATH } from '@crewchief/core/account-deletion';

import { CONTACT_EMAIL, LAST_UPDATED, OPERATOR } from '@/lib/legal';

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/**
 * Collapse whitespace before matching prose.
 *
 * JSX wraps sentences at the print margin, so a claim that reads as one line
 * on screen is split across three in the source with indentation in between.
 * The first version of this file asserted against the raw text and two guards
 * failed on sentences that were present and correct — a test that goes red for
 * the formatter is a test people learn to re-run rather than read.
 */
const flat = (s: string) => s.replace(/\s+/g, ' ');

const privacy = read('app/privacy/page.tsx');
const terms = read('app/terms/page.tsx');
const privacyText = flat(privacy);
const termsText = flat(terms);

describe('the legal pages exist where the App Store listing will point', () => {
  /*
    The privacy policy URL is a mandatory App Store Connect field and 3.1.2
    requires a reachable terms link in the binary once subscriptions ship.
    Both were absent from this product entirely until 14 Aug — not missing
    links, missing pages — so "does the route exist" is a real assertion here
    rather than a tautology.
  */

  it('serve a privacy policy and terms of use', () => {
    expect(privacy).toContain('export default function PrivacyPolicyPage');
    expect(terms).toContain('export default function TermsPage');
  });
});

describe('claims the rest of the codebase has to keep true', () => {
  it('does not promise anything about tracking that the manifest contradicts', () => {
    /*
      The policy tells people there is no advertising identifier and no
      cross-app tracking. `app.json`'s privacy manifest is the machine-readable
      version of the same claim, and Apple cross-checks it.

      If a future commit flips tracking on, `privacy-manifest.test.ts` catches
      the manifest — and this catches the sentence, which is the half a
      reviewer reads and no manifest test covers.
    */
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const appJson = require('../../apps/mobile/app.json');
    const manifest = appJson.expo.ios.privacyManifests;

    expect(manifest.NSPrivacyTracking).toBe(false);
    expect(manifest.NSPrivacyTrackingDomains).toEqual([]);

    expect(privacyText).toMatch(/No advertising identifier/i);
    expect(privacyText).toMatch(/do not track you across other/i);
  });

  it('names the VIN disclosure, which is the one nobody expects', () => {
    /*
      `app/actions.ts` sends the VIN to NHTSA's public decoder. It is the least
      obvious thing that leaves the product, it is more identifying than "car
      details" suggests, and it is exactly the line an edit tightening the prose
      would drop as detail.
    */
    expect(privacy).toContain('NHTSA');
    expect(privacyText).toMatch(/VIN, it is sent to NHTSA/i);
  });

  it('describes deletion in the order deletion actually happens', () => {
    // `deleteAccount` purges storage *then* cascades the rows, because the
    // cascade removes the only reference to the objects. A policy describing
    // the reverse would be claiming a guarantee the code does not make.
    expect(privacyText).toMatch(/removes your uploaded files first/i);
  });
});

describe('the two documents cannot contradict the app', () => {
  it('sends people to the same place to cancel as the in-app notice', () => {
    /*
      The terms page imports this string from core rather than restating it, so
      this asserts the import was not later "simplified" into a literal that
      then drifted. Someone reading only one of the two surfaces must not be
      told a different way to stop being charged.
    */
    expect(SUBSCRIPTION_CANCEL_PATH).toBeTruthy();
    expect(terms).toContain('SUBSCRIPTION_CANCEL_PATH');
    expect(terms).not.toContain('Settings → your name → Subscriptions');
  });

  it('agrees with the app that deleting an account does not cancel billing', () => {
    // `subscriptionNotice` says this in the app. Both documents say it too,
    // because it is the one thing here that costs money to get wrong.
    expect(termsText).toMatch(/deleting your crewchief account does not stop the/i);
    expect(privacyText).toMatch(/does not cancel an App Store subscription/i);
  });
});

describe('who operates the service, and who to write to about it', () => {
  /*
    ── ⚠ Read this before "fixing" either assertion ────────────────────────────

    These two constants are at different stages on purpose, and the asymmetry is
    the whole content of this block.

    `OPERATOR` was a bracketed placeholder until 18 Aug. It is now David's legal
    name, because the Apple membership submitted 16 Aug is **Individual, not
    Organization** — so the App Store seller name is his personal name whatever
    the entity question (Q2) eventually decides. The placeholder outlived its
    premise: `lib/legal.ts` said it must be replaced "before either page is
    linked publicly", and the pages went public on 17 Aug when
    `crewchief.davidmasterson.co` became both the mobile client's API origin and
    the App Store listing's privacy-policy URL.

    `CONTACT_EMAIL` is still bracketed, and still renders as literal body text on
    that public page. It is not an oversight — David is standing up a dedicated
    address rather than publishing a personal one, and there is nothing true to
    write until it exists. **The assertion below goes red the moment it is
    filled in. That is the intent**: it is the prompt to bump `LAST_UPDATED` and
    promote to `web-live`, not a regression.

    ⚠ A green run here does not mean the public page is fixed. Nothing deploys
    from `main`; `crewchief.davidmasterson.co` serves `web-live`.
  */

  it('names a real operator rather than a bracketed placeholder', () => {
    expect(OPERATOR).toBe('David Masterson');

    // Anti-vacuous: this must still be able to catch a placeholder coming back.
    expect(OPERATOR).not.toMatch(/[[\]]|TBD|not yet|to be decided/i);
    expect(OPERATOR.trim().length).toBeGreaterThan(0);
  });

  it('has not shipped a plausible-looking fake contact address', () => {
    /*
      The failure mode guarded against is a well-meaning edit substituting
      something that *reads* finished — `support@crewchief.com`, an address
      nobody monitors, or one on a hostname with no MX. A bracketed placeholder
      is worse-looking and better: it cannot silently fail to reach anyone.
    */
    expect(CONTACT_EMAIL).toContain('[CONTACT EMAIL');
    expect(CONTACT_EMAIL).not.toContain('@');
  });

  it('interpolates both constants rather than restating them in the pages', () => {
    /*
      Asserting the sources were found at all. Without this, both guards above
      keep passing while a page renders a hardcoded literal beside them — the
      constant would be correct and the published document wrong, which is the
      exact defect `lib/legal.ts` centralises these to prevent.
    */
    for (const [name, source] of [['privacy', privacy], ['terms', terms]] as const) {
      expect(`${name}: ${source.includes('{OPERATOR}')}`).toBe(`${name}: true`);
      expect(`${name}: ${source.includes('{CONTACT_EMAIL}')}`).toBe(`${name}: true`);
    }
  });

  it('carries a last-updated date no earlier than the operator being named', () => {
    /*
      `LAST_UPDATED` is the date the *content* changed, and naming the operator
      of the service is the most substantive line in either document. Leaving it
      at 14 August published a policy whose stated last-changed date preceded
      the change it was describing.
    */
    expect(LAST_UPDATED).toBe('18 August 2026');
    expect(new Date(LAST_UPDATED).getTime()).not.toBeNaN();
    expect(new Date(LAST_UPDATED).getTime()).toBeGreaterThanOrEqual(
      new Date('14 August 2026').getTime(),
    );
  });
});
