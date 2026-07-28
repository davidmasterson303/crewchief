'use client';

import { useEffect, useRef, useState } from 'react';
import { useCountUp } from '@/hooks/use-count-up';
import { useHealthBand } from '@/hooks/use-health-band';

interface DiagnosticHeroProps {
  imageUrl?: string | null;
  vehicleName: string;
  healthScore?: number;
  focalX?: number | null;
  /** 0–100. Vertical crop anchor for the desktop cover crop. */
  focalY?: number | null;
}

/**
 * The page-width vehicle hero.
 *
 * ── The bug this shape exists to fix ────────────────────────────────────────
 *
 * This was a ~4:1 letterbox filled with `cover` and anchored at centre. Owner
 * photos are 3:4 portrait phone snapshots with the car in the bottom half, so
 * cover enlarged them ~3x and kept a horizontal band through the vertical
 * centre — reliably sky, ceiling, or garage lights. The car was not in the
 * hero at all. Nothing was malfunctioning: the geometry was unsurvivable, and
 * `center` is the wrong default for the photographs this product receives.
 *
 * `.photo-hero` fixes it in two directions. Desktop crops low (`--focal-y`,
 * defaulting to 80%) and grades the photo; at ≤640px the image switches to
 * `contain` over a blurred copy of itself, so the whole car stays visible and
 * nothing is cropped.
 *
 * It deliberately does not use `.photo-plate`. Cards keep the plate; a
 * page-width hero is a different problem, and sharing one class is how the two
 * drift into each other.
 *
 * ── --focal-y, and the column that already existed ──────────────────────────
 *
 * The v6 ticket asked for a new stored `hero_focal_y`. It is not needed:
 * `vehicles.focal_point_y` has existed since March, is already piped through
 * to this component, and already has an owner-facing editor in
 * VehiclePhotoUploadDialog. A second column would be a second source of truth
 * for one concept.
 *
 * The only real gap was the default, and CSS closes it. `--focal-y` is emitted
 * *only* when a value is stored, so `object-position: 50% var(--focal-y, 80%)`
 * gives the hero its low anchor while VehicleCard keeps its own behaviour off
 * the same stored number.
 *
 * ── What was dropped, deliberately ──────────────────────────────────────────
 *
 * The image no longer parallaxes. It relied on `scale(1.12)` to have room to
 * translate without exposing the edges, and any scale defeats the mobile
 * `contain` behaviour whose entire purpose is that nothing is cropped. The
 * content block still fades on scroll.
 */
export default function DiagnosticHero({
  imageUrl,
  vehicleName,
  healthScore,
  focalY,
}: DiagnosticHeroProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scanDone, setScanDone] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const [mounted, setMounted] = useState(false);

  /*
    ── A URL is not a photograph ───────────────────────────────────────────────

    Having a string in `imageUrl` is not evidence that anything will render, and
    this hero has already shipped the failure once: every owner photo uploaded
    after the bucket went private held a `/object/public/…` URL that returned
    400, and this component rendered two broken `<img>` elements over the empty
    state rather than falling back to it.

    That specific cause is fixed upstream — the column holds a path now and
    `useVehicleImage` signs it. But the object can still be missing for reasons
    no caller can check in advance: it was deleted out from under the row, or
    the signed URL was minted against something no longer there. So the load
    failure itself is the signal, and the only one that is actually reliable.

    The *failed URL* is remembered rather than a boolean, so a fresh signed URL
    for the same object clears the state on its own. Signed URLs are re-minted
    roughly every 30 minutes, which makes a genuinely absent object cost one
    failed request per refresh — and makes a transient failure self-heal without
    a remount.
  */
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const photo = imageUrl && imageUrl !== failedUrl ? imageUrl : undefined;

  // Shared primitives: the same band table and the same rAF loop as
  // HealthSummary's ScoreRing, so the two can never disagree about one score.
  const band = useHealthBand(healthScore ?? 0);
  const displayScore = useCountUp(healthScore ?? 0, 1400, scanDone && !!healthScore);

  useEffect(() => {
    setMounted(true);
    const timer = setTimeout(() => setScanDone(true), 900);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) setScrollY(Math.max(0, -rect.top));
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const fadeOpacity = Math.max(0, 1 - scrollY / 320);

  /*
    Emit the variable only when a value is actually stored. Passing '50%'
    whenever the column is null would quietly reinstate the centred crop this
    change exists to remove — the CSS fallback of 80% has to be allowed to win.
  */
  const focalStyle =
    focalY != null ? ({ ['--focal-y']: `${focalY}%` } as React.CSSProperties) : undefined;

  return (
    <div
      ref={containerRef}
      className={`photo-hero rounded-2xl border border-white/10${photo ? '' : ' ph-empty'}`}
      style={focalStyle}
    >
      {/* Both take the same src. The fill is display:none above 640px, so
          desktop pays nothing for it. Either one failing condemns the src, so
          both report — the fill is the one that is hidden on desktop, and a
          hero that stayed broken on desktop because only the hidden image was
          wired up would be a worse bug than the one this fixes. */}
      {photo && (
        <img
          className="ph-fill"
          src={photo}
          alt=""
          aria-hidden="true"
          onError={() => setFailedUrl(photo)}
        />
      )}
      {photo && (
        <img
          className="ph-img"
          src={photo}
          alt={vehicleName}
          onError={() => setFailedUrl(photo)}
        />
      )}
      <div className="ph-tint" />
      <div className="ph-bed" />

      {mounted && !scanDone && photo && (
        <div
          className="scan-line left-0 right-0 h-[2px] pointer-events-none"
          /*
            position and z-index are set inline on purpose. `.photo-hero > *`
            sets `position: relative`, and a Tailwind `absolute` class is the
            same specificity — which is exactly how `.above-stretch` knocked the
            card's options menu out of its corner earlier. Inline always wins.
          */
          style={{
            position: 'absolute',
            zIndex: 4,
            background:
              'linear-gradient(90deg, transparent 0%, rgba(34,211,238,0) 5%, rgba(34,211,238,1) 50%, rgba(34,211,238,0) 95%, transparent 100%)',
            boxShadow: '0 0 18px 4px rgba(34,211,238,0.55), 0 0 40px 8px rgba(34,211,238,0.18)',
            animation: 'scanLine 0.85s cubic-bezier(0.4,0,0.6,1) forwards',
          }}
        />
      )}

      <div className="ph-content" style={{ opacity: fadeOpacity }}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-white/40 mb-1">
            {!photo ? 'Add a photo' : scanDone ? 'Diagnostics Complete' : 'Scanning...'}
          </p>
          {/* A hero is the one place both serif roles are allowed at once — the
              name and the hero numeral read as a single moment. */}
          <h2 className="display-serif text-3xl sm:text-4xl text-white tracking-tight leading-none">
            {vehicleName}
          </h2>
        </div>

        {/* The score renders once, here, and never on raw photography. */}
        {healthScore !== undefined && (
          <div className="ph-glass">
            <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Health Score</p>
            <div className="flex items-baseline gap-1">
              {/* Numeral stays Inter: tabular figures matter more than flourish
                  on a value that animates digit by digit. */}
              <span
                className="num text-4xl font-bold leading-none"
                style={{
                  color: band.color,
                  filter: scanDone ? `drop-shadow(0 0 8px rgba(${band.rgb},0.45))` : 'none',
                }}
              >
                {scanDone ? Math.round(displayScore) : '—'}
              </span>
              <span className="text-base text-white/35">/100</span>
            </div>
            {/* Derived from the score, never passed in — a hand-written label
                is how 61 came to be called "Good". */}
            <p className="text-xs font-semibold mt-0.5" style={{ color: band.color }}>
              {scanDone ? band.label : ' '}
            </p>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes scanLine {
          0% {
            top: 0%;
            opacity: 0;
          }
          5% {
            opacity: 1;
          }
          95% {
            opacity: 1;
          }
          100% {
            top: 100%;
            opacity: 0;
          }
        }
        .scan-line {
          top: 0;
        }
      `}</style>
    </div>
  );
}
