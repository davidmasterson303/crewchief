'use client';

export default function DemoBanner() {
  return (
    <div className="relative z-50 w-full shrink-0 bg-[#0A0A0A] border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3 sm:gap-4">
        {/*
          `min-w-0` is the whole fix. A flex item defaults to `min-width: auto`,
          which refuses to shrink below its content — so with the right-hand
          link marked `shrink-0`, neither side could give and the row pushed the
          document wider than the viewport at 320, 360 and 375. That widened the
          *layout viewport* on every route, because this banner is rendered
          outside the route tree.

          The left side is the side that yields: it is a byline, and the right
          link is the only actionable thing in the bar.
        */}
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <a
            href="https://davidmasterson.co/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs font-semibold tracking-[0.18em] text-[#C4845C] hover:text-[#d49a72] transition-colors uppercase whitespace-nowrap truncate"
          >
            DAVID MASTERSON.
          </a>
          <span className="text-[#2a2a2a] select-none shrink-0">|</span>
          {/* Hidden rather than truncated at the narrowest widths: "Portfolio
              Demo" clipped to "Portfo…" is worse than absent, and the byline
              beside it already carries the same signal. */}
          <span className="hidden min-[380px]:inline text-xs tracking-[0.1em] uppercase text-[#EDE8DF]/40 font-medium whitespace-nowrap">
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
