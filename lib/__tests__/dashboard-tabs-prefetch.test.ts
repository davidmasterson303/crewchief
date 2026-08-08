/**
 * The dashboard tab bar switches sections without re-booting the page.
 *
 * @jest-environment node
 *
 * ── Why this file exists, including the part that was wrong ─────────────────
 *
 * 8 Aug: tabs reported unreachable. A hydration race was diagnosed, the tab bar
 * was changed to native `<a>` elements, and a suite called
 * `dashboard-tabs-native.test.ts` was written to pin that.
 *
 * **The diagnosis was an artifact and that suite pinned the wrong thing.** The
 * automated clicks used to "reproduce" the bug were going into a *background*
 * browser tab — `document.visibilityState === 'hidden'` — where a synthetic
 * click does not drive navigation. Every symptom followed from that.
 *
 * The native anchors did make tabs change, but at a cost worse than the
 * original complaint: every switch became a full page load. Measured on
 * production, warm:
 *
 *   - server response for all four routes: **0.4–0.6s TTFB**
 *   - client boot: **~2.7s**, 26 script chunks, paid on *every* switch
 *
 * The server was never slow. The reload was.
 *
 * ── What is pinned now ──────────────────────────────────────────────────────
 *
 * `Link` transfers only the changed route segment and leaves the shell, nav and
 * vehicle header mounted — the "load the tab's content, not the whole page"
 * behaviour, provided by the framework rather than hand-rolled. `prefetch`
 * fetches that segment during idle time so it is local before the click.
 *
 * The rule is therefore **both**: a `Link`, and an explicit `prefetch`. A
 * `Link` without prefetch still works and is still slower than it needs to be,
 * which is exactly the kind of quiet regression a ratchet is for.
 *
 * ── Why a source scan ───────────────────────────────────────────────────────
 *
 * The subject is which component the markup uses and which prop it carries.
 * jsdom has no router, no segment cache and no prefetch, so a rendered test
 * could observe none of it — and the real evidence for the behaviour is a
 * browser measurement, which belongs in the record above rather than in an
 * assertion.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const LAYOUT = join(__dirname, '..', '..', 'components', 'DashboardLayout.tsx');

/**
 * The `tabs.map(...)` block only.
 *
 * The logo and footer legitimately use `Link` too, so a whole-file scan would
 * pass for the wrong reason — it would find *their* `Link` and never notice the
 * tab bar had changed.
 */
function tabBlock(): string {
  const source = readFileSync(LAYOUT, 'utf8');
  const start = source.indexOf('{tabs.map(');
  const end = source.indexOf('})}', start);

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

/** Comments stripped — this file's own docblock names `<a>` to explain the history. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

describe('the dashboard tab bar', () => {
  it('uses Link, so a switch transfers one segment rather than reloading', () => {
    expect(code(tabBlock())).toMatch(/<Link\b/);
  });

  it('is not a native anchor, which would reload the whole page', () => {
    /*
      The regression this exists for is a well-meaning "just use a plain link"
      — which is what shipped for a few hours and cost ~2.7s of client boot per
      switch. Comments are stripped first; the docblock above deliberately
      discusses `<a>`.
    */
    const block = code(tabBlock());

    expect(block).not.toMatch(/<a\b/);
    expect(block).not.toMatch(/<\/a>/);
  });

  it('prefetches, so the segment is local before the click', () => {
    // Without this the tabs work and are merely slower than they need to be —
    // the quiet kind of regression nobody files a bug about.
    expect(code(tabBlock())).toMatch(/\bprefetch\b/);
  });

  it('still carries a real href on every tab', () => {
    // `Link` without `href` renders nothing navigable while looking identical.
    expect(code(tabBlock())).toMatch(/href=\{href\(vehicle\.id\)\}/);
  });

  it('keeps the 44px target the RB0 floor requires', () => {
    // Easy to lose while editing the same element, and this is the one control
    // every signed-in session touches.
    expect(code(tabBlock())).toMatch(/min-h-\[44px\]/);
  });

  it('scans only the tab block, not the whole file', () => {
    /*
      Guards the guard. If `tabBlock()` ever captured the file, the "not a
      native anchor" case would start failing on the footer's `mailto:` anchor
      and the obvious fix would be to weaken it.
    */
    const source = readFileSync(LAYOUT, 'utf8');

    expect(source).toMatch(/<a href="mailto:/);
    expect(code(tabBlock())).not.toMatch(/mailto:/);
  });
});
