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

  it('the generated card branches too, and did not', () => {
    /*
      ── ⚠ Found 1 Sep, the same defect one surface further out ──────────────

      `app/opengraph-image.tsx` is the share **image**, and its sub-line read
      *"Live demo with sample vehicles — no signup required"* on **both**
      deployments. So the picture attached to every share of
      `crewchief.davidmasterson.co` — the App Store listing's own marketing URL
      — called the product a demo, in 30px type, while the description tag
      beside it correctly did not.

      It was missed for the same reason the 20 Aug one was: a convention route
      generates it outside the app, so nothing that reviews pages reviews it.
      The assertions above check `shareDescription`; this checks the picture.
    */
    const card = readFileSync(
      join(__dirname, '..', '..', 'app', 'opengraph-image.tsx'),
      'utf8'
    );

    // It has to ask which site it is on at all.
    expect(card).toContain('isDemoSite(process.env.CREWCHIEF_DEMO_SITE)');

    /*
      ⚠ And it must sit on the **demo** arm. A substring check alone would pass
      for the version that had the sentence on both sides, which is the bug.

      Comments are stripped first: the paragraph above this assertion quotes
      the offending line while explaining it, and a scan satisfied by prose is
      the failure CLAUDE.md §5 records twice over — the same reason the
      `layout` constant at the top of this file is stripped.
    */
    const rendered = card
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');

    const branch = rendered.slice(rendered.indexOf('isDemoSite(process.env.CREWCHIEF_DEMO_SITE)'));
    const demoArm = branch.slice(0, branch.indexOf(':'));
    const productArm = branch.slice(branch.indexOf(':'));

    expect(demoArm.toLowerCase()).toContain('no signup');
    expect(productArm.toLowerCase()).not.toContain('no signup');
    expect(productArm.toLowerCase()).not.toContain('demo');

    // Said once, on one arm — not on both, which is what shipped.
    expect(rendered.match(/no signup required/gi) ?? []).toHaveLength(1);
  });

  it('draws no SVG text, because Satori answers 200 with an empty PNG', () => {
    /*
      ── ⚠ The failure mode, which is the reason this assertion exists ───────

      Satori refuses SVG text — *"<text> nodes are not currently supported,
      please convert them to <path>"* — and refuses it by **returning HTTP 200
      with `content-type: image/png` and a zero-byte body**. A scraper gets a
      valid-looking response and a broken picture; the app looks fine; no
      source-reading test can tell.

      Caught on 1 Sep by generating the card and measuring it, after a rebrand
      put the plate's engraved name in an SVG `<text>`. The plate is paths now
      and the name is a positioned div, which is how the wordmark on this card
      has always been set.

      ⚠ This does not prove the card renders — only a request can do that, and
      `npm run dev` plus `curl -o` is the check. What it prevents is the one
      construct known to produce the silent version.
    */
    const card = readFileSync(
      join(__dirname, '..', '..', 'app', 'opengraph-image.tsx'),
      'utf8'
    )
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');

    expect(card).not.toMatch(/<text[\s>]/);

    // Anti-vacuous: it must still be drawing SVG, or this passes for a card
    // that lost its mark entirely.
    expect(card).toMatch(/<svg[\s>]/);
    expect(card).toMatch(/<path[\s>]/);
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
