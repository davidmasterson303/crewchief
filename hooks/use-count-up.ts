'use client';

import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './use-reduced-motion';

/**
 * Animates a number from 0 to `target` on mount.
 *
 * Used for hero figures that arrive with a value already known — the health
 * score, cost totals — so they resolve into place rather than snapping in.
 *
 * Reduced motion: the blanket CSS rule in globals.css only neutralises CSS
 * transitions and animations. A requestAnimationFrame loop is invisible to
 * it, so this checks matchMedia itself and jumps straight to the final value.
 * The end state is always reached — the effect is skipped, never the result.
 */
export function useCountUp(
  target: number,
  durationMs = 900,
  /**
   * Gate the start. `DiagnosticHero` holds its score back until its scan
   * animation finishes, so the number doesn't run before the reveal.
   * Under reduced motion the gate is ignored — the value lands immediately.
   */
  enabled = true
): number {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0));
  const frameRef = useRef<number>();

  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }

    /*
      requestAnimationFrame does not run while the document is hidden, so a
      counter started in a background tab sits at 0 with no frame ever
      arriving. Unlike a missed transition this is a *wrong number* on screen:
      the hero rendered "0" beside the label "Fair", which is a health score of
      74 describing itself as zero.

      Same reasoning as use-scroll-reveal — animating early costs an
      animation, not animating costs the content. Found the same way too, by
      reading a value out of a hidden browser pane.
    */
    if (typeof document !== 'undefined' && document.hidden) {
      setValue(target);
      return;
    }

    if (!enabled) {
      setValue(0);
      return;
    }

    const start = performance.now();
    const from = 0;

    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(elapsed / durationMs, 1);
      // ease-out-cubic: fast départ, gentle settle.
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (target - from) * eased);

      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        setValue(target);
      }
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
    };
  }, [target, durationMs, enabled]);

  return value;
}

