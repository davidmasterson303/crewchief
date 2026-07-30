'use client';

import { useEffect, useRef, useState } from 'react';
import { useCountUp } from '@/hooks/use-count-up';
import { useHealthBand } from '@/hooks/use-health-band';
import { VehicleIdentity } from '@/components/VehicleIdentity';

interface DiagnosticHeroProps {
  /** A renderable photo URL, already signed by the caller. Null is expected. */
  photo?: string | null;
  vehicleName: string;
  year?: number | string | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  healthScore?: number;
  /** One line on why the score is what it is. Optional. */
  reason?: string | null;
  /** Band height. 400px is the design default. */
  height?: number;
}

/**
 * The vehicle dashboard hero — CC-142 §3.
 *
 * ── What this replaces, and why it was worth replacing ──────────────────────
 *
 * The previous hero composited the photograph through six layers: a 42% warm
 * brown `.ph-tint`, `saturate(.62)`, a vignette, a double scrim from both
 * edges, and a duplicate 0×0 `<img>` — over a page background that was *the
 * same photograph again* at 18%. Measured passthrough at the bottom of the
 * hero was ~1.7%. Only about 75px of a 338px element was unobstructed, and
 * roughly a tenth of each 700 KB photograph did any visual work.
 *
 * The photographs were never the problem. The compositing was.
 *
 * ── Nothing is printed over the photograph any more ─────────────────────────
 *
 * The score and the vehicle's name used to sit *on* the image, which is what
 * made the scrims necessary in the first place — text over an unpredictable
 * photograph needs something to sit on. Moving the content beneath the band
 * removes the requirement rather than tuning it, and the band gets to be a
 * photograph instead of a textured backdrop.
 *
 * ── The crop anchor is gone with the crop ───────────────────────────────────
 *
 * `focalX` / `focalY` are no longer props. `VehicleIdentity` contains the
 * photo over a blurred copy of itself rather than cropping it, so there is no
 * crop to anchor. The columns still exist and are still edited in
 * VehiclePhotoUploadDialog; nothing on this screen reads them.
 */
export default function DiagnosticHero({
  photo,
  vehicleName,
  year,
  make,
  model,
  trim,
  healthScore,
  reason,
  height = 400,
}: DiagnosticHeroProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scanDone, setScanDone] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Shared primitives: the same band table as HealthSummary's ScoreRing, so
  // the two can never disagree about one score.
  const band = useHealthBand(healthScore ?? 0);
  const displayScore = useCountUp(healthScore ?? 0, 1400, scanDone && !!healthScore);

  useEffect(() => {
    setMounted(true);
    const timer = setTimeout(() => setScanDone(true), 900);
    return () => clearTimeout(timer);
  }, []);

  const score = healthScore ?? 0;
  const shown = scanDone ? Math.round(displayScore) : 0;

  return (
    <section
      ref={containerRef}
      aria-label={vehicleName}
      className="rounded-2xl overflow-hidden border border-white/8"
    >
      <div className="relative">
        <VehicleIdentity
          variant="band"
          photo={photo ?? null}
          year={year}
          make={make}
          model={model}
          trim={trim}
          height={height}
        />

        {/*
          The scan sweep. Transient — it runs once, for 850ms, and leaves
          nothing behind. That is what keeps it compatible with "no tint,
          vignette or scrim over any in-app photograph": those are persistent
          layers that cost the photo permanently, this is motion.
        */}
        {mounted && !scanDone && (
          <div
            className="scan-line absolute left-0 right-0 h-[2px] pointer-events-none"
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
      </div>

      {/*
        Beneath the band: the score, and the reason for it. The vehicle's name
        lives here now rather than on the photograph.
      */}
      <div className="bg-[#0f1318]/90 px-6 sm:px-8 py-6">
        {/*
          The vehicle is not named again here.

          It was, in a serif h2 directly under the band — and on a car with no
          photograph that printed the model twice within about 150px, because the
          plate above carries "M235i / 2015 BMW · xDrive" precisely when there is
          no photo to carry instead. A third copy sits in the page heading a
          couple of hundred pixels higher. Three renderings of one fact on one
          screen.

          VehicleIdentity's docblock already draws this line: "when a photo
          renders, the type and the glyph do not… Callers put a vehicle's name in
          the layout around the band, not on top of it." The page heading is that
          layout. This band's job is the photograph, the status and the score.

          `vehicleName` is kept as the section's accessible name, so a screen
          reader still hears which vehicle the hero belongs to — the information
          was never the problem, the third copy of it was.
        */}
        <p className="label-uppercase mb-6">
          {!photo ? 'No photo yet' : scanDone ? 'Diagnostics complete' : 'Scanning…'}
        </p>

        {healthScore !== undefined && (
          <div className="flex flex-col sm:flex-row sm:items-end gap-4 sm:gap-8">
            <div className="flex items-baseline gap-2">
              {/* Numeral stays Inter: tabular figures matter more than flourish
                  on a value that animates digit by digit. */}
              <span
                className="num text-6xl font-bold leading-none"
                style={{
                  color: band.color,
                  textShadow: scanDone ? `0 0 44px rgba(${band.rgb},0.22)` : 'none',
                }}
              >
                {scanDone ? shown : '—'}
              </span>
              <span className="text-lg text-white/35">/100</span>
              {/* Derived from the score, never passed in — a hand-written label
                  is how 61 came to be called "Good". */}
              <span
                className="text-sm font-semibold ml-1"
                style={{ color: band.color }}
              >
                {scanDone ? band.label : ''}
              </span>
            </div>

            {/*
              A band scale, not a progress bar. The ticks are the point: a bare
              fill says "more is better" and nothing else, while 40 / 60 / 80
              are where the label actually changes. A score of 62 sitting just
              past a tick reads very differently from 62 on an unmarked track.
            */}
            <div className="flex-1 min-w-[180px] pb-1">
              <div className="relative h-[3px] rounded-full bg-white/10">
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
                  style={{
                    width: `${Math.max(0, Math.min(100, scanDone ? shown : 0))}%`,
                    background: band.color,
                  }}
                />
                {[40, 60, 80].map((tick) => (
                  <span
                    key={tick}
                    aria-hidden="true"
                    className="absolute top-[-3px] w-px h-[9px] bg-white/25"
                    style={{ left: `${tick}%` }}
                  />
                ))}
                {scanDone && (
                  <span
                    aria-hidden="true"
                    className="absolute top-[-3px] w-[2px] h-[9px] rounded-full transition-[left] duration-300"
                    style={{
                      left: `${Math.max(0, Math.min(100, shown))}%`,
                      background: band.color,
                    }}
                  />
                )}
              </div>
              <div className="relative mt-1.5 h-3">
                {[40, 60, 80].map((tick) => (
                  <span
                    key={tick}
                    className="num absolute text-[10px] text-white/30 -translate-x-1/2"
                    style={{ left: `${tick}%` }}
                  >
                    {tick}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {reason && <p className="text-sm text-white/50 mt-4">{reason}</p>}
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
    </section>
  );
}
