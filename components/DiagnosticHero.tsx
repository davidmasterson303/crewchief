'use client';

import { useEffect, useRef, useState } from 'react';

interface DiagnosticHeroProps {
  imageUrl: string;
  vehicleName: string;
  healthScore?: number;
  focalX?: number | null;
  focalY?: number | null;
}

function useCountUp(target: number, duration: number, enabled: boolean) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!enabled || target === 0) return;
    setValue(0);
    const start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      setValue(Math.round(eased * target));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled]);
  return value;
}

export default function DiagnosticHero({ imageUrl, vehicleName, healthScore, focalX, focalY }: DiagnosticHeroProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scanDone, setScanDone] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const [mounted, setMounted] = useState(false);

  const resolvedFocalX = focalX ?? 50;
  const resolvedFocalY = focalY ?? 50;

  const displayScore = useCountUp(healthScore || 0, 1400, scanDone && !!healthScore);

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
        <div
          className="absolute inset-0"
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
          <h2 className="text-2xl font-bold text-white tracking-tight">{vehicleName}</h2>
        </div>
        {healthScore !== undefined && (
          <div className="flex flex-col items-end">
            <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Health Score</p>
            <div className="flex items-baseline gap-1">
              <span
                className="text-4xl font-bold tabular-nums"
                style={{
                  color: healthScore >= 80 ? '#4ade80' : healthScore >= 60 ? '#22d3ee' : '#fb923c',
                  filter: scanDone ? `drop-shadow(0 0 8px ${healthScore >= 80 ? 'rgba(74,222,128,0.45)' : healthScore >= 60 ? 'rgba(34,211,238,0.45)' : 'rgba(251,146,60,0.45)'})` : 'none',
                }}
              >
                {scanDone ? displayScore : '—'}
              </span>
              <span className="text-base text-white/35">/100</span>
            </div>
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
