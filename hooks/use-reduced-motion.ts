'use client';

/**
 * Does this visitor want motion reduced?
 *
 * One copy, because there were three and an audit found two places that had
 * none. `docs/roadmap.md` item 17 asks for reduced-motion coverage "as one
 * audited list rather than per-feature memory" — this is the list's single
 * entry point, and `lib/__tests__/reduced-motion.test.ts` is the ratchet that
 * keeps new motion from skipping it.
 *
 * ── What the blanket CSS rule does and does not reach ────────────────────────
 *
 * `globals.css` neutralises `animation-duration`, `transition-duration` and
 * `scroll-behavior` under `prefers-reduced-motion: reduce`. That covers every
 * CSS animation in the app — the garage door lift, the diagnostic scan line,
 * the photo fade, the gauge's label entrance — and nothing needs to ask.
 *
 * Two kinds of motion are invisible to it:
 *
 *   1. `requestAnimationFrame` loops. CSS cannot see them, so they run at full
 *      length regardless. Every rAF loop has to check this itself.
 *   2. `scrollTo({ behavior: 'smooth' })`. The option is specified to *win*
 *      over the `scroll-behavior` property, so the blanket rule is overridden
 *      by the call site — the one case where CSS looks like it has it covered
 *      and does not.
 *
 * Returns false during SSR, which is the safe direction: the value is read in
 * effects and event handlers, and a first render that assumes motion is
 * allowed is corrected before anything animates.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** `scrollTo`/`scrollIntoView` behaviour honouring the same preference. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}
