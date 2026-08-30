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

import { SUBSCRIPTION_CANCEL_PATH } from '@wellkept/core/account-deletion';

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
    expect(termsText).toMatch(/deleting your well kept account does not stop the/i);
    expect(privacyText).toMatch(/does not cancel an App Store subscription/i);
  });
});

describe('who operates the service, and who to write to about it', () => {
  /*
    ── Both constants are now real, and the guard changed shape with them ──────

    This block was a countdown for five days. `OPERATOR` was filled in on 18 Aug
    — the Apple membership is **Individual, not Organization**, so the seller
    name is David's legal name whatever the entity question (Q2) decides — and
    `CONTACT_EMAIL` on 19 Aug. Both were bracketed placeholders rendering as
    literal body text on a page App Review reads, and both are now named.

    **What the assertions guard has inverted, and deliberately.** While the
    values were absent the risk was somebody replacing them with something that
    merely *read* finished. Now that they are present the risk is the reverse: a
    later edit quietly putting a placeholder, an empty string or an unmonitored
    address back. So each one asserts a real value and separately asserts that a
    placeholder would still be caught.

    ⚠ A green run here does not mean the public page is fixed. Nothing deploys
    from `main`; `crewchief.davidmasterson.co` serves `web-live`, and these
    values reach a reader only after a promote.
  */

  it('names a real operator rather than a bracketed placeholder', () => {
    /*
      ⚠ Changed 30 Aug: the operator is **Southmoor Digital LLC**, not a person.

      The pin is the point. This value decides who a reader is contracting with
      and who is accountable for what the product says about their car, so it
      moves only when David says it moves — an entity appearing or disappearing
      here through a merge, a refactor or a find-and-replace is the failure this
      exact literal exists to stop.
    */
    expect(OPERATOR).toBe('Southmoor Digital LLC');

    // Anti-vacuous: this must still be able to catch a placeholder coming back.
    expect(OPERATOR).not.toMatch(/[[\]]|TBD|not yet|to be decided/i);
    expect(OPERATOR.trim().length).toBeGreaterThan(0);
  });

  it('names a contact address somebody actually reads', () => {
    /*
      `crewchief.support@gmail.com` — deliberately not a domain address, and
      that is worth recording because it looks like a compromise and is not.

      `support@davidmasterson.co` carries David's name, which gives back most of
      what a dedicated address was for, and `crewchief.co` is not his. Apple
      requires a support *URL* in the listing, not a domain-based address, so a
      customer is pointed at the site either way. The property that matters on a
      privacy policy is that the address is answered — this one is verified
      receiving and delegated to his own mailbox.
    */
    expect(CONTACT_EMAIL).toBe('crewchief.support@gmail.com');
  });

  it('would still catch a placeholder or an unreachable address coming back', () => {
    /*
      Anti-vacuous, and the direction of the risk has flipped. While these were
      empty the hazard was a plausible-looking fake; now that they are filled it
      is a regression putting a bracket, a blank or a bare word back — none of
      which would look wrong in a diff.
    */
    expect(CONTACT_EMAIL).not.toMatch(/[[\]]|TBD|not yet|to be decided/i);
    expect(CONTACT_EMAIL).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
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
      `LAST_UPDATED` is the date the content changed *for a reader*, which is
      the ship date rather than the commit date — nothing deploys from `main`,
      so a date moved on 18 August described a change nobody could see. Operator
      and contact reach the public page together on 19 August.

      Pinned to an exact literal rather than a floor, deliberately. A floor
      would let any edit drag the date forward, including a styling one, and the
      file's own docblock is explicit that a date which moves for a CSS change
      teaches people the date means nothing. An exact pin makes every bump a
      line somebody had to write on purpose.

      ⚠ Moved to 30 August with the operator becoming Southmoor Digital LLC.
      Unlike the 19 August bump, this one is ahead of its own promote: web-live
      has been frozen since 23 Aug, so the published policy still names David
      personally. If the promote slips past the 30th, this literal and the
      constant both move to the day it runs.
    */
    expect(LAST_UPDATED).toBe('30 August 2026');
    expect(new Date(LAST_UPDATED).getTime()).not.toBeNaN();
    expect(new Date(LAST_UPDATED).getTime()).toBeGreaterThanOrEqual(
      new Date('14 August 2026').getTime(),
    );
  });
});
