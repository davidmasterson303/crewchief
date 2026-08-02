'use client';

import { useEffect, useRef, useState } from 'react';
import { VehicleIdentity } from '@/components/VehicleIdentity';
import { ClusterGauge } from '@/components/ClusterGauge';

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

  /*
    The band table and the count-up both moved into ClusterGauge, which owns
    the reading now. Keeping a second copy of either here is how the numeral
    and the dial would come to disagree about one score — the exact drift the
    old comment on this line was written to prevent, so the rule is unchanged
    and only its address has moved.
  */

  useEffect(() => {
    setMounted(true);
    const timer = setTimeout(() => setScanDone(true), 900);
    return () => clearTimeout(timer);
  }, []);

  const score = healthScore ?? 0;

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

        {/*
          One instrument, where there used to be a numeral and a separate
          linear track beside it.

          The track's own comment made the argument this inherits: a bare fill
          says "more is better" and nothing else, while 40 / 60 / 80 are the
          only points on the scale where the label actually changes. That was
          right, and the ticks survive — they have moved onto the arc, where
          the reading and the scale are finally the same object rather than two
          renderings of one number sitting side by side.

          Deliberately *not* an additional dial next to the score. D5 removed
          HealthSummary's ring from this page precisely because the dashboard
          was printing the same figure twice within a screen; adding a gauge
          beside the numeral would have reintroduced that with extra ink. The
          numeral lives in the well of the arc, which is where a cluster puts
          it.
        */}
        {healthScore !== undefined && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-9">
            <ClusterGauge score={score} active={scanDone} />
            {reason && (
              <p className="text-sm text-white/50 leading-relaxed flex-1 max-w-prose">{reason}</p>
            )}
          </div>
        )}

        {healthScore === undefined && reason && (
          <p className="text-sm text-white/50 mt-4">{reason}</p>
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
    </section>
  );
}
