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

describe('what is still unfinished is visibly unfinished — now on a public page', () => {
  it('has not shipped a plausible-looking fake operator or contact', () => {
    /*
      CrewChief has no legal entity (Q2, open). The placeholders are bracketed
      and self-describing on purpose: a policy naming an entity that does not
      exist is worse than one that admits it is incomplete, and the failure mode
      to guard against is a well-meaning edit replacing them with something that
      *reads* finished.

      This test goes red when they are filled in. That is the intent — it is the
      prompt to delete it and link the pages publicly.

      ── ⚠ 17 Aug: THE PREMISE ABOVE HAS FLIPPED ─────────────────────────────

      `lib/legal.ts` says these "must be replaced before either page is linked
      publicly". **They are now linked publicly.** Two things happened on the
      same day:

        - The mobile Account screen builds its Terms and Privacy links from
          `API_BASE_URL`, which is now `https://crewchief.davidmasterson.co` —
          a real hostname on its own certificate, not a generated preview name.
        - That same URL goes in the App Store listing's privacy-policy field,
          which App Review reads.

      So `[OPERATOR NAME — see Q2, entity not yet formed]` currently renders as
      **literal body text on a public page**, and Q2 has stopped being only a
      revenue question. Found by Cowork while wiring the domain; verified by
      fetching the live page.

      This assertion is deliberately **not** inverted yet, because filling it in
      is David's call and turning the suite red would block unrelated work on a
      decision that is not an engineering one. It is a countdown now rather than
      a steady state, and it must be resolved before submission rather than
      before launch.

      ⚠ The Apple enrolment may already have answered it: the membership is
      **Individual, not Organization**, so the App Store seller name is David's
      personal legal name. An operator field naming that is consistent with what
      Apple will display, and needs no entity to exist first.
    */
    const legal = read('lib/legal.ts');
    expect(legal).toContain('[OPERATOR NAME');
    expect(legal).toContain('[CONTACT EMAIL');
  });
});
