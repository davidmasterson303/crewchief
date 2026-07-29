'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, ChevronDown, Gauge } from 'lucide-react';
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
 * `INTRO_PANEL_SETTLED_MS`**, because the door starts lifting at
 * `INTRO_HOLD_MS` and fades this whole panel out as it goes. They previously
 * ran to 1220ms against a 900ms hold, so three of the four elements were still
 * fading in while the wrapper faded out — they composited to something
 * permanently dim, and the headline was at full strength for 50ms. A test
 * holds the relationship now; the numbers here are half of it.
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

        <motion.div
          className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-12"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.42, ease: 'easeOut' }}
        >
          <button
            onClick={onEnter}
            className="enter-garage-btn group relative flex items-center gap-2 h-14 px-9 text-base font-semibold text-black rounded-full overflow-hidden transition-all duration-300 hover:shadow-[0_0_32px_rgba(34,211,238,0.45)] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            style={{
              background: 'linear-gradient(105deg, #22d3ee 0%, #38bdf8 50%, #3b82f6 100%)',
              minWidth: '200px',
            }}
          >
            <span className="shimmer-layer absolute inset-0 pointer-events-none" aria-hidden="true" />
            <span className="relative z-10 flex items-center gap-2">
              Enter Garage
              <ArrowRight className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1.5" />
            </span>
          </button>

          <button
            onClick={() => setDrawerOpen(true)}
            className="group flex items-center gap-2 h-14 px-7 text-base font-medium text-white/80 hover:text-white rounded-full border border-white/[0.18] bg-transparent hover:bg-white/[0.07] transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            Learn More
            <ChevronDown className="h-4 w-4 transition-transform duration-300 group-hover:translate-y-0.5" />
          </button>
        </motion.div>

        <motion.div
          className="mt-8"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32, duration: 0.38, ease: 'easeOut' }}
        >
          <Link href="/demo">
            <button className="demo-btn group relative flex items-center gap-2.5 px-6 py-3 rounded-full border border-cyan-400/25 bg-transparent hover:bg-cyan-500/10 transition-all duration-250 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50">
              <span className="absolute inset-0 rounded-full pointer-events-none demo-glow" aria-hidden="true" />
              <Gauge className="relative z-10 h-4 w-4 text-cyan-400 transition-transform duration-300 group-hover:scale-110" />
              <span className="relative z-10 text-sm font-medium text-cyan-300 group-hover:text-cyan-200 tracking-wide">
                Take a Test Drive
              </span>
              <ArrowRight className="relative z-10 h-3.5 w-3.5 text-cyan-400/70 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-cyan-400" />
              <span className="relative z-10 text-xs text-white/30 ml-0.5">— no signup needed</span>
            </button>
          </Link>
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

        .demo-glow {
          box-shadow: 0 0 0 0 rgba(34, 211, 238, 0);
          transition: box-shadow 0.3s ease;
        }

        .demo-btn:hover .demo-glow {
          box-shadow: 0 0 18px 2px rgba(34, 211, 238, 0.18);
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
