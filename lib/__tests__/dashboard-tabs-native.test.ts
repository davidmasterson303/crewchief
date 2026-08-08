/**
 * The dashboard tab bar navigates without waiting for React.
 *
 * @jest-environment node
 *
 * ── The defect, reproduced on production ────────────────────────────────────
 *
 * 8 Aug, signed in, on a real vehicle: **clicking any tab within ~2.7s of page
 * load did nothing at all.** Not queued, not delayed — discarded. The same
 * click on a settled page worked.
 *
 * ~2.7s is the `load` event on that page across 26 script files, and it is the
 * entire window in which somebody is looking at a dashboard that appears
 * finished and is not. The reported symptom was "I can't click between tabs,
 * I'm stuck on dashboard".
 *
 * ── Why it is worse than having no JavaScript ───────────────────────────────
 *
 * React hydrates far enough for `next/link` to call `preventDefault()` — this
 * was captured directly, `click (bubble end): prevented=true` — but not far
 * enough for the router transition to run. The browser's own navigation is
 * cancelled and nothing replaces it.
 *
 * A page with JS disabled entirely would have navigated correctly.
 *
 * ── What was ruled out, by measurement ──────────────────────────────────────
 *
 * Every one of these was checked before the fix, because "the link is broken"
 * has several much more ordinary explanations:
 *
 *   - all four routes return 200
 *   - the `href`s are correct
 *   - no console error
 *   - **nothing overlays the tabs** — `elementFromPoint` at the tab centre was
 *     sampled at t=0, 400ms, 800ms, 1.5s, 2.5s and 3.5s, and the anchor itself
 *     was the top element every time
 *   - a programmatic `a.click()` navigates at any moment; only a real click
 *     inside the window fails
 *
 * ── Why a source scan ───────────────────────────────────────────────────────
 *
 * The property is "this element is a native anchor", which is a fact about the
 * markup. Rendering it under jsdom would prove neither half of the bug: jsdom
 * has no hydration race to lose a click to, and no navigation to observe. The
 * browser reproduction above is the evidence; this is the ratchet that stops it
 * coming back.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const LAYOUT = join(__dirname, '..', '..', 'components', 'DashboardLayout.tsx');

/**
 * The `tabs.map(...)` block only — not the whole file.
 *
 * The logo and the footer legitimately use `Link`, and holding them to this
 * rule would be a different (and unargued) decision. The claim here is
 * specifically about the primary section nav.
 */
function tabBlock(): string {
  const source = readFileSync(LAYOUT, 'utf8');
  const start = source.indexOf('{tabs.map(');
  const end = source.indexOf('})}', start);

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('the dashboard tab bar', () => {
  it('renders native anchors', () => {
    const block = tabBlock();

    expect(block).toMatch(/<a\b/);
    expect(block).toMatch(/<\/a>/);
  });

  it('does not use next/link', () => {
    /*
      To change this back: first confirm the hydration window is gone. Load the
      dashboard, click a tab inside the first second, and check the URL
      actually changed. If it did not, `Link` is still swallowing it and this
      rule is still load-bearing.
    */
    const block = tabBlock();

    expect(block).not.toMatch(/<Link\b/);
    expect(block).not.toMatch(/<\/Link>/);
  });

  it('still carries a real href on every tab', () => {
    // A native anchor with no href is not a link at all — it would look
    // identical and navigate nowhere, which is the bug again by another route.
    const block = tabBlock();

    expect(block).toMatch(/href=\{href\(vehicle\.id\)\}/);
  });

  it('keeps the 44px target the RB0 floor requires', () => {
    // Unrelated to the navigation fix, and easy to lose while editing the same
    // element. This is the one control every signed-in session touches.
    const block = tabBlock();

    expect(block).toMatch(/min-h-\[44px\]/);
  });

  it('leaves the rest of the file free to use Link', () => {
    // Guards the guard: if `tabBlock()` ever captured the whole file, the
    // "does not use next/link" case above would start failing for the logo and
    // the footer, and the obvious fix would be to weaken it.
    const source = readFileSync(LAYOUT, 'utf8');

    expect(source).toMatch(/<Link href=\{homeHref\}/);
  });
});
