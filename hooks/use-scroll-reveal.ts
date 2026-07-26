'use client';

import { useEffect, useRef } from 'react';

/**
 * Reveals an element as it scrolls into view.
 *
 * Pair with the `.scroll-reveal` class in globals.css: the class supplies the
 * hidden start state and the transition, this hook adds `.in-view` to trigger
 * it. Deliberately slower and travelling further than the mount stagger, so
 * the two entrance behaviours read as different gestures rather than
 * competing.
 *
 * Reduced motion: the CSS media query cannot help here, because an element
 * that never receives `.in-view` would simply stay invisible. So this checks
 * matchMedia and reveals immediately — the content always ends up visible.
 *
 *   const ref = useScrollReveal<HTMLDivElement>();
 *   <section ref={ref} className="scroll-reveal">…</section>
 */
/**
 * Staggered delay for siblings inside one revealed group.
 *
 * Steps 75ms apart and caps at 6, because past that the last card arrives
 * noticeably after the user has already looked at it. The cap matters most on
 * the garage grid, which can hold far more than six cards.
 *
 * The index is per-group, not per-page — reset it for each revealed section,
 * or a long page ends up with a second group that starts already late.
 *
 *   {items.map((item, i) => (
 *     <Card key={item.id} className="scroll-reveal" style={revealDelay(i)} />
 *   ))}
 */
export function revealDelay(index: number, stepMs = 75, maxSteps = 6) {
  const step = Math.min(index, maxSteps);
  return { transitionDelay: `${step * stepMs}ms` };
}

export function useScrollReveal<T extends HTMLElement>(threshold = 0.15) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reveal = () => el.classList.add('in-view');

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    /*
      Reveal immediately, without observing, when:

        - motion is reduced
        - IntersectionObserver is missing
        - the document is hidden

      That last one is not theoretical. IntersectionObserver does not fire at
      all while `document.hidden` is true, so anything rendered in a
      background tab — or by a headless screenshotter, link-preview
      generator or print pipeline — stays at opacity 0 with no callback ever
      arriving. Found while verifying this in a hidden browser pane: a fresh
      observer on a plainly-visible element simply never fired.

      Revealing early costs an animation. Not revealing costs the content.
    */
    const hidden = typeof document !== 'undefined' && document.hidden;

    if (reduced || hidden || typeof IntersectionObserver === 'undefined') {
      reveal();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            reveal();
            // One-shot: re-animating on every scroll-by is noise.
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return ref;
}
