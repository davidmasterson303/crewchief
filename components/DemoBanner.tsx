'use client';

export default function DemoBanner() {
  return (
    <div className="relative z-50 w-full bg-[#0A0A0A] border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <a
            href="https://davidmasterson.co/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs font-semibold tracking-[0.18em] text-[#C4845C] hover:text-[#d49a72] transition-colors uppercase"
          >
            DAVID MASTERSON.
          </a>
          <span className="text-[#2a2a2a] select-none">|</span>
          <span className="text-xs tracking-[0.1em] uppercase text-[#EDE8DF]/40 font-medium">
            Portfolio Demo
          </span>
          <span className="hidden sm:inline text-[#2a2a2a] select-none">·</span>
          <span className="hidden sm:inline text-xs text-[#EDE8DF]/25 tracking-wide">
            Shared demo garage &mdash; AI Consultant is fully live
          </span>
        </div>
        <a
          href="https://davidmasterson.co/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs tracking-[0.15em] uppercase font-medium text-[#C4845C]/50 hover:text-[#C4845C] transition-colors shrink-0"
        >
          View Portfolio &rarr;
        </a>
      </div>
    </div>
  );
}
