'use client';

import { useScrollReveal, revealDelay } from '@/hooks/use-scroll-reveal';

interface RevealOnScrollProps {
  children: React.ReactNode;
  /**
   * Position within its group. Drives the stagger, capped at 6 steps so the
   * last card in a long grid does not arrive after the user has looked at it.
   * Reset per group — a second section starting at index 12 would begin
   * already late.
   */
  index?: number;
  className?: string;
}

/**
 * Reveals its child as it scrolls into view.
 *
 * A component rather than a bare hook because `useScrollReveal` returns a ref,
 * and hooks cannot be called inside a `.map()` — which is exactly where the
 * staggered reveals are needed.
 *
 * Safety lives in the hook and the CSS, not here: `.scroll-reveal` only hides
 * under `@media (scripting: enabled)`, and the hook reveals immediately when
 * motion is reduced or IntersectionObserver is missing. The failure mode being
 * guarded against is content stranded invisible, which is worse than content
 * that simply appears without animating.
 */
export function RevealOnScroll({ children, index = 0, className = '' }: RevealOnScrollProps) {
  const ref = useScrollReveal<HTMLDivElement>();

  return (
    <div ref={ref} className={`scroll-reveal ${className}`} style={revealDelay(index)}>
      {children}
    </div>
  );
}
