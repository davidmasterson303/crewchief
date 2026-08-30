/**
 * The Well Kept mark — "Sweep" — and its two lockups.
 *
 * This file is the only place the mark's path data exists, on either
 * platform's web side. Placements render <Logo/>; nothing loads an SVG file.
 * (The files in public/brand/ are for contexts outside the app — email
 * signatures, press — and are generated from the same geometry.)
 *
 * The one behaviour that must never be left to call sites: **the cut switch
 * at 24px.** Below 24 the redline and the hub-to-arc relationship turn to
 * mush, so the mark swaps to a heavier, redline-free drawing with the same
 * silhouette. The switch is mechanical on `size` — a call site cannot render
 * the wrong cut.
 *
 * Colour rules (the system's, not this file's):
 *   - default mark colour is `--brand-accent`; the four other approved
 *     treatments pass `color` (and `mono` for the two one-colour ones).
 *   - cyan-400 is light, never a surface — on any light ground pass
 *     `--brand-accent-button` (#0E7490), never leave cyan-400 on white.
 *   - butt caps everywhere. A round cap paints a stub at zero and runs every
 *     reading ~2% long; the system already forbids it on both dials.
 *   - the redline is heat (#FF4436, `--build-redline`), not `--critical-red`.
 *     Do not unify them.
 */
import * as React from 'react';

export type LogoVariant = 'mark' | 'horizontal' | 'stacked';

export interface LogoProps {
  variant?: LogoVariant;
  /** Mark height in px. Drives the 24px cut switch and lockup proportions. */
  size?: number;
  /** Mark colour. Defaults to the brand accent. */
  color?: string;
  /**
   * Name colour in the lockups. Defaults to `--text-primary`; the one-colour
   * treatments pass the same value as `color`.
   */
  nameColor?: string;
  /** One-colour treatments: drop the redline. */
  mono?: boolean;
  className?: string;
}

/* Lockup proportions, from the spec's 46px-mark master: gap = M × 0.348,
   name cap set from a 32/46 ratio. Stacked master is 60: gap 9.6, name 24. */
const H_GAP = 16 / 46;
const H_NAME = 32 / 46;
const S_GAP = 9.6 / 60;
const S_NAME = 24 / 60;

function Mark({
  size,
  color,
  mono,
  standalone,
  className,
}: {
  size: number;
  color: string;
  mono: boolean;
  standalone: boolean;
  className?: string;
}) {
  const small = size < 24;
  const a11y = standalone
    ? ({ role: 'img', 'aria-label': 'Well Kept' } as const)
    : ({ 'aria-hidden': true } as const);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      style={{ color }}
      className={className}
      {...a11y}
    >
      {small ? (
        <>
          <g fill="none" stroke="currentColor" strokeLinecap="butt">
            <path d="M50 84 A34 34 0 1 1 84 50" strokeWidth="14" />
            <path d="M50 50 L55.9 21.5" strokeWidth="12" />
          </g>
          <circle cx="50" cy="50" r="7" fill="currentColor" />
        </>
      ) : (
        <>
          <g fill="none" strokeLinecap="butt">
            <path d="M50 85 A35 35 0 1 1 85 50" stroke="currentColor" strokeWidth="10" />
            {!mono && (
              <path
                d="M74.75 25.25 A35 35 0 0 1 85 50"
                stroke="var(--build-redline)"
                strokeWidth="10"
              />
            )}
            <path d="M50 50 L55.21 20.45" stroke="currentColor" strokeWidth="8" />
          </g>
          <circle cx="50" cy="50" r="5.5" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

export function Logo({
  variant = 'mark',
  size = 24,
  color = 'var(--brand-accent)',
  nameColor = 'var(--text-primary)',
  mono = false,
  className,
}: LogoProps) {
  if (variant === 'mark') {
    return <Mark size={size} color={color} mono={mono} standalone className={className} />;
  }

  const horizontal = variant === 'horizontal';
  const gap = size * (horizontal ? H_GAP : S_GAP);
  const nameSize = size * (horizontal ? H_NAME : S_NAME);

  /* The name is real text beside an aria-hidden mark, so assistive tech reads
     "Well Kept" once, as words. Two words, both capitalised — never
     "WellKept", never all-caps, never a colour split between them.

     ⚠ The tracking below was cut for "CrewChief", a single nine-letter word.
     It has not been re-cut for a two-word mark, and `public/brand`'s lockups
     still draw the old wordmark as outlines. Design's call; logged in
     docs/design-system-drift.md. */
  return (
    <span
      className={`inline-flex ${horizontal ? 'flex-row items-center' : 'flex-col items-center'}${
        className ? ` ${className}` : ''
      }`}
      style={{ gap }}
    >
      <Mark size={size} color={color} mono={mono} standalone={false} />
      <span
        style={{
          fontSize: nameSize,
          fontWeight: 700,
          letterSpacing: horizontal ? '-0.035em' : '-0.03em',
          lineHeight: 1,
          color: nameColor,
        }}
      >
        Well Kept
      </span>
    </span>
  );
}

export default Logo;
