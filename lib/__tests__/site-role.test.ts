/**
 * Which site this build thinks it is.
 *
 * @jest-environment node
 *
 * The whole content of this file is a direction: an unconfigured deploy must
 * resolve to *the product*, never to the demo. Both halves are tested — the
 * parsing rule, and the structural fact that `DemoBanner` is no longer rendered
 * unconditionally, which is the defect this replaced.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEMO_ORIGIN,
  PRODUCT_ORIGIN,
  isDemoSite,
  shareDescription,
  siteOrigin,
} from '@/lib/site-role';

describe('an unconfigured deploy is the product site', () => {
  it.each([
    ['unset', undefined],
    ['null', null],
    ['empty', ''],
    ['whitespace', '   '],
  ])('resolves %s to the product site', (_name, value) => {
    /*
      ⚠ The asymmetry that makes this the right direction. Forgotten on the
      demo, the portfolio piece loses a byline and David sees it within a day.
      Forgotten on the product, Apple reads a privacy policy under a masthead
      calling the service a demo — invisible to us, found by a reviewer.
    */
    expect(isDemoSite(value)).toBe(false);
  });

  it.each([['false'], ['0'], ['no'], ['off'], ['demo'], ['1'], ['yes']])(
    'does not treat %s as an instruction to show the demo framing',
    (value) => {
      /*
        Specifically including `false` and `0`. A plain truthiness check would
        turn a variable somebody set to "false", meaning to switch the banner
        off, into the thing that switches it on.
      */
      expect(isDemoSite(value)).toBe(false);
    }
  );

  it.each([['true'], ['TRUE'], ['True'], ['  true  ']])('enables on %s', (value) => {
    // Anti-vacuous: it must still be possible to turn on, or the assertions
    // above pass against a function that always returns false.
    expect(isDemoSite(value)).toBe(true);
  });
});

/**
 * `app/layout.tsx` with comments removed.
 *
 * Stripped because this file's own docblocks name `DemoBanner`, `siteOrigin`
 * and the demo hostname while *explaining* them — and a scan satisfied by prose
 * is the failure CLAUDE.md §5 records twice over.
 */
const layout = readFileSync(join(__dirname, '..', '..', 'app', 'layout.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('the banner is not rendered unconditionally', () => {
  it('renders it only behind the site-role gate', () => {
    /*
      The structural half, and the reason this test exists rather than trusting
      the parsing test alone: `isDemoSite` can be perfectly correct while the
      layout renders the banner beside it regardless. That was the defect —
      unconditional rendering — and it is invisible in a diff that only adds a
      helper.

      Comments are stripped first because this file's own docblock explains the
      gate, and a scan satisfied by prose is the failure CLAUDE.md §5 records.
    */
    expect(layout).toContain('isDemoSite');

    const renders = layout.match(/<DemoBanner\s*\/>/g) ?? [];
    expect(renders).toHaveLength(1);

    // The render must sit inside a conditional naming the gate, not beside it.
    expect(layout).toMatch(/isDemoSite\([^)]*\)\s*&&\s*<DemoBanner\s*\/>/);
  });

  it('reads the gate from the server environment, not a client-exposed one', () => {
    /*
      `layout.tsx` is a server component, so the value never needs to reach the
      browser bundle. A `NEXT_PUBLIC_` prefix would ship a deployment detail to
      every visitor for no benefit.
    */
    expect(layout).toContain('process.env.CREWCHIEF_DEMO_SITE');
    expect(layout).not.toContain('NEXT_PUBLIC_CREWCHIEF_DEMO_SITE');
  });
});

describe('the share card describes the site it is actually on', () => {
  /*
    Found live on 20 Aug: the App Store's hostname was serving the demo's
    `og:url`, `og:image` and description. The visible page was correct
    throughout, which is why two promotes and every visual pass missed it —
    metadata is the part of a page nobody looks at and everybody else reads.
  */

  it('claims its own origin, not the other site’s', () => {
    expect(siteOrigin(false)).toBe(PRODUCT_ORIGIN);
    expect(siteOrigin(true)).toBe(DEMO_ORIGIN);
    // The bug in one assertion: the product must not advertise the demo host.
    expect(siteOrigin(false)).not.toContain('demo');
  });

  it('never calls the product a demo', () => {
    /*
      ⚠ Not stylistic. Apple reads this hostname, and "live demo … no signup
      required" is the Guideline 4.2 argument made in our own words.
    */
    expect(shareDescription(false).toLowerCase()).not.toContain('demo');
    expect(shareDescription(false).toLowerCase()).not.toContain('no signup');
  });

  it('keeps the invitation on the demo, where it is true', () => {
    // Anti-vacuous: the rule above must not have flattened both to one string.
    expect(shareDescription(true).toLowerCase()).toContain('demo');
    expect(shareDescription(true)).not.toBe(shareDescription(false));
  });

  it('is wired into the layout rather than left as a helper nobody calls', () => {
    /*
      The same structural check the masthead needed, and for the same reason:
      a correct helper beside a hardcoded literal is exactly what shipped here.
    */
    expect(layout).toContain('siteOrigin(');
    expect(layout).toContain('shareDescription(');
    // No demo host as a bare literal anywhere in the metadata any more.
    expect(layout).not.toMatch(/url:\s*'https:\/\/crewchief-demo/);
    expect(layout).not.toMatch(/metadataBase[\s\S]{0,120}'https:\/\/crewchief-demo/);
  });
});
