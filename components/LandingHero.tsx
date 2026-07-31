'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import FeaturesDrawer from './FeaturesDrawer';

/**
 * The pitch that sits on the garage door. Content only.
 *
 * It used to be the curtain as well as the content: it owned an
 * `AnimatePresence`, a 1.41 MB photograph of a garage door as its backdrop,
 * four stacked black gradients over that photograph (the topmost at 0.97, which
 * is why the door read as very nearly black on screen), and an `isOpen` prop
 * whose state lived in whichever page happened to render it.
 *
 * All of that moved to `components/GarageDoor.tsx`. What is left is a headline
 * and three calls to action, which is all this ever needed to be — and it is
 * now testable and reusable without dragging a full-screen fixed overlay along
 * with it.
 *
 * **The staggered entrances below must all finish inside
 * `INTRO_PANEL_SETTLED_MS`.** This panel carries the button that opens the
 * door, and a control still fading in is a control nobody can press. They
 * previously ran to 1220ms against a door that started lifting at 900ms, so
 * three of the four elements were still arriving while the wrapper faded out —
 * they composited to something permanently dim, and the headline was at full
 * strength for 50ms. A test holds the relationship now; the numbers here are
 * half of it.
 */

interface LandingHeroProps {
  /**
   * Raises the door immediately. Supplied by `GarageDoor`'s panel render prop;
   * this component never holds the door's state itself.
   */
  onEnter: () => void;
}

export default function LandingHero({ onEnter }: LandingHeroProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <div className="flex w-full max-w-4xl flex-col items-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.45, ease: 'easeOut' }}
        >
          <h1
            className="text-6xl md:text-[5.25rem] font-bold text-white leading-tight"
            style={{ letterSpacing: '-0.04em' }}
          >
            Your Personal Auto
            <br />
            <span
              className="text-transparent bg-clip-text gradient-text-animate"
              style={{
                backgroundImage:
                  'linear-gradient(90deg, #22d3ee 0%, #38bdf8 25%, #60a5fa 50%, #38bdf8 75%, #22d3ee 100%)',
                backgroundSize: '200% 100%',
                letterSpacing: '-0.045em',
              }}
            >
              Ownership Consultant
            </span>
          </h1>
        </motion.div>

        <motion.p
          className="text-xl text-gray-300 leading-relaxed mx-auto mt-6"
          style={{ maxWidth: '600px' }}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.45, ease: 'easeOut' }}
        >
          CrewChief researches your exact year, make and trim — what fails, when it fails, and what
          to bundle so one shop visit does the work of three.
        </motion.p>

        {/*
          Three ways in, in a deliberate order of weight.

          Two things were wrong before. Sign in and sign up were *identical*
          outline pills, giving equal weight to unequal actions — and the nav
          under the door said the opposite, rendering sign-up filled and sign-in
          as plain text. The same pair, two hierarchies, on the same page.

          One hierarchy now, and the nav matches it: enter the demo, then sign
          up, then sign in.

          Radius is the design-system token (`--radius`, consumed as rounded-xl)
          rather than rounded-full. The v4 notes in globals.css record that radii
          were deliberately *sharpened*; the pill shape here predated that and
          was the last place still round, so the landing page was advertising a
          product it no longer looked like.

          Nothing says "free": whether there is a free tier is undecided.
        */}
        <motion.div
          className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-12"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.42, ease: 'easeOut' }}
        >
          <button
            onClick={onEnter}
            className="enter-garage-btn group relative flex items-center justify-center gap-2 h-14 px-9 text-base font-semibold text-black rounded-xl overflow-hidden transition-all duration-300 hover:glow-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            style={{
              background: 'linear-gradient(105deg, #22d3ee 0%, #38bdf8 50%, #3b82f6 100%)',
              minWidth: '200px',
            }}
          >
            <span className="shimmer-layer absolute inset-0 pointer-events-none" aria-hidden="true" />
            <span className="relative z-10 flex items-center gap-2">
              Enter demo
              <ArrowRight className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1.5" />
            </span>
          </button>

          <Link
            href="/signup"
            className="flex items-center justify-center h-14 px-7 text-base font-semibold text-white bg-cyan-600 hover:bg-cyan-500 rounded-xl transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            Sign up
          </Link>

          <Link
            href="/login"
            className="flex items-center justify-center h-14 px-7 text-base font-medium text-white/70 hover:text-white rounded-xl border border-white/[0.14] bg-transparent hover:bg-white/[0.06] transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            Sign in
          </Link>
        </motion.div>

        {/*
          Learn more is deliberately not a button.

          The three above are ways *in* — they change where you are. This one
          only opens a panel of explanation and leaves you exactly where you
          were, so giving it the same pill would advertise it as a fourth door.
          An underlined text control in a quieter colour says "reading, not
          leaving", which is what it does.
        */}
        <motion.div
          className="mt-9"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32, duration: 0.38, ease: 'easeOut' }}
        >
          <button
            onClick={() => setDrawerOpen(true)}
            className="group inline-flex items-center gap-1.5 text-sm font-normal text-white/45 hover:text-white/75 underline decoration-white/20 hover:decoration-white/50 decoration-1 underline-offset-[5px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 rounded"
          >
            What CrewChief does
            <ChevronDown className="h-3.5 w-3.5 opacity-60 transition-transform duration-300 group-hover:translate-y-0.5" />
          </button>
        </motion.div>
      </div>

      <style jsx global>{`
        .shimmer-layer {
          background: linear-gradient(
            110deg,
            transparent 25%,
            rgba(255, 255, 255, 0.22) 50%,
            transparent 75%
          );
          background-size: 200% 100%;
          animation: shimmer 2.8s infinite linear;
        }

        @keyframes shimmer {
          0%   { background-position: 200% center; }
          100% { background-position: -200% center; }
        }

        .enter-garage-btn:hover {
          padding-left: 2.4rem;
          padding-right: 2.4rem;
        }

        .gradient-text-animate {
          animation: gradientShift 5s linear infinite;
        }

        @keyframes gradientShift {
          0%   { background-position: 0% center; }
          100% { background-position: 200% center; }
        }
      `}</style>

      <FeaturesDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
    </>
  );
}
