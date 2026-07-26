'use client';

import { useEffect, useRef, useState } from 'react';
import { useCountUp } from '@/hooks/use-count-up';
import { useHealthBand } from '@/hooks/use-health-band';

interface DiagnosticHeroProps {
  imageUrl: string;
  vehicleName: string;
  healthScore?: number;
  focalX?: number | null;
  focalY?: number | null;
}

export default function DiagnosticHero({ imageUrl, vehicleName, healthScore, focalX, focalY }: DiagnosticHeroProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scanDone, setScanDone] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const [mounted, setMounted] = useState(false);

  const resolvedFocalX = focalX ?? 50;
  const resolvedFocalY = focalY ?? 50;

  // Shared primitives: same band table and same rAF loop as HealthSummary's
  // ScoreRing. The local copies this replaced diverged — different easing, and
  // no reduced-motion check at all.
  const band = useHealthBand(healthScore ?? 0);
  const displayScore = useCountUp(healthScore ?? 0, 1400, scanDone && !!healthScore);

  useEffect(() => {
    setMounted(true);
    const timer = setTimeout(() => setScanDone(true), 900);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const offset = Math.max(0, -rect.top);
        setScrollY(offset);
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const parallaxOffset = scrollY * 0.35;
  const fadeOpacity = Math.max(0, 1 - scrollY / 320);

  const objectPosition = `${resolvedFocalX}% ${resolvedFocalY}%`;

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-2xl border border-white/10"
      style={{ height: '320px' }}
    >
      <div
        className="absolute inset-0 w-full"
        style={{
          transform: `translateY(${parallaxOffset}px) scale(1.12)`,
          transformOrigin: `${resolvedFocalX}% ${resolvedFocalY}%`,
          height: '100%',
        }}
      >
        <img
          src={imageUrl}
          alt={vehicleName}
          className="w-full h-full object-cover"
          style={{ objectPosition }}
        />
        {/* Vignette sits under the scrim — the pairing is the signature. */}
        <div className="absolute inset-0 vignette-frame pointer-events-none" aria-hidden="true" />
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            background: 'linear-gradient(to bottom, rgba(9,11,15,0.05) 0%, rgba(9,11,15,0.35) 55%, rgba(9,11,15,0.85) 100%)',
          }}
        />
      </div>

      {mounted && !scanDone && (
        <div
          className="absolute left-0 right-0 h-[2px] z-20 pointer-events-none scan-line"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, rgba(34,211,238,0.0) 5%, rgba(34,211,238,1) 50%, rgba(34,211,238,0.0) 95%, transparent 100%)',
            boxShadow: '0 0 18px 4px rgba(34,211,238,0.55), 0 0 40px 8px rgba(34,211,238,0.18)',
            animation: 'scanLine 0.85s cubic-bezier(0.4,0,0.6,1) forwards',
          }}
        />
      )}

      {scanDone && (
        <div
          className="absolute inset-0 pointer-events-none z-10 scan-reveal"
          style={{
            background: 'linear-gradient(135deg, rgba(34,211,238,0.025) 0%, transparent 50%)',
            opacity: fadeOpacity,
          }}
        />
      )}

      <div
        className="absolute bottom-0 left-0 right-0 z-20 p-6 flex items-end justify-between"
        style={{ opacity: fadeOpacity }}
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-white/40 mb-1">
            {scanDone ? 'Diagnostics Complete' : 'Scanning...'}
          </p>
          {/* The one Newsreader element on this screen — see .display-serif. */}
          <h2 className="display-serif text-3xl text-white tracking-tight">{vehicleName}</h2>
        </div>
        {healthScore !== undefined && (
          <div className="flex flex-col items-end">
            <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Health Score</p>
            <div className="flex items-baseline gap-1">
              {/* Numeral stays Inter: tabular figures matter more than flourish
                  on a value that animates digit by digit. */}
              <span
                className="num text-4xl font-bold"
                style={{
                  color: band.color,
                  filter: scanDone ? `drop-shadow(0 0 8px rgba(${band.rgb},0.45))` : 'none',
                }}
              >
                {scanDone ? Math.round(displayScore) : '—'}
              </span>
              <span className="text-base text-white/35">/100</span>
            </div>
            {/* Qualitative label carries the same band colour as the numeral,
                so hero and ScoreRing can never disagree on one dashboard. */}
            <p className="text-xs font-semibold mt-0.5" style={{ color: band.color }}>
              {scanDone ? band.label : ' '}
            </p>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes scanLine {
          0%   { top: 0%; opacity: 0; }
          5%   { opacity: 1; }
          95%  { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        .scan-line {
          top: 0;
        }
        .scan-reveal {
          animation: revealFade 0.6s ease-out forwards;
        }
        @keyframes revealFade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
