'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import FeaturesDrawer from './FeaturesDrawer';
import BrandLockup from '@/components/brand/BrandLockup';
import { AppStoreCTA } from './AppStoreCTA';
import { useIsDemoSite } from '@/components/SiteRoleProvider';

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
  /*
    ── Which site is asking, decided 22 Aug ──────────────────────────────────

    The two hostnames want different things from a visitor, and until now they
    asked for the same one. A recruiter arriving at the portfolio piece should
    be shown the product working; somebody arriving at the product should be
    asked to use it. "Enter demo" as the primary action on the product host
    said "this is a demo" more loudly than any tagline could — the CTA *is* the
    positioning.

    ⚠ The demo does not disappear from the product host, it demotes. "See a
    sample garage" is a real and useful thing to offer somebody deciding
    whether to sign up, and removing it would leave the page asking for a
    commitment with nothing to show first.
  */
  const isDemoSite = useIsDemoSite();

  return (
    <>
      {/*
        ── ⚠ A scrim, because the door and the copy shared a tonal band ───────

        `.garage-door` is a drawn gradient stack and a good one — mid-grey
        metal with slat ribbing and section seams, lifted twelve points so the
        headline has something to sit on. What it is not is a background: it is
        high-frequency texture at the same tone as body copy, directly behind
        body copy.

        A design critique measured the consequence: "the paragraph is
        gray-on-striped-gray… on a phone in daylight this paragraph will be
        hard to read", and "vertical panel seams run straight through the
        headline". Its remedy is the one taken here — "darken the door 30–40%
        behind the content column, or scrim it".

        ⚠ A radial rather than a flat wash. A rectangle of black over a
        photographed-looking surface reads as a panel sitting on the door; an
        ellipse centred on the content falls off before it reaches an edge, so
        the door still turns the corner behind it and the metal is still
        legible where nothing is written.

        `pointer-events-none` — the opener beneath must stay pressable.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 78% 62% at 50% 46%, rgba(8,8,9,0.86) 0%, rgba(8,8,9,0.72) 42%, rgba(8,8,9,0) 78%)',
        }}
      />
      <div className="relative flex w-full max-w-4xl flex-col items-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.45, ease: 'easeOut' }}
        >
          {/*
            The stacked lockup, primary treatment on the graphite plate. It
            rides the headline's motion.div rather than getting its own
            stagger — every entrance here must finish inside
            INTRO_PANEL_SETTLED_MS, and a new staggered element would move
            that finish line.
          */}
          <div className="flex justify-center mb-10">
            {/*
              ⚠ The lockup only. Design's Landing deliverable rewrites this
              page — the tagline, the hero, the CTA — and that is a separate
              piece of work. Swapping the mark now stops the landing page being
              the one surface still showing the retired dial; it is not an
              attempt to do the landing redesign early.
            */}
            <BrandLockup width={240} />
          </div>
          {/*
            ── ⚠ Three things were wrong here, and they were one thing ───────

            **It was 60px on a phone.** "Your Personal Auto" at `text-6xl` in a
            390px column is one word per line: the headline rendered as a
            five-line word stack costing about 700px of the only screen most
            visitors will see. A design critique called it "the single loudest
            tell that no one typeset it".

            **The break made it parse wrong.** "Your Personal Auto /
            Ownership Consultant" reads "Your Personal Auto" as a unit before
            "Ownership" arrives. The phrase is *auto-ownership*, hyphenated,
            and breaking it there is the only place it can break.

            **The gradient was the trope.** Animated cyan-to-blue clipped to
            the last two words is the most recognisable AI-landing-page
            treatment of the past two years, and this page ran three cyan
            gradients at once — this one, the CTA pill and the plaque's glow.
            It also spent the brand's own light on decoration, which is the
            demotion the rest of the product just went through.

            What replaces it is the face the mark is already set in. The plaque
            above is Newsreader small caps; a grotesque headline underneath it
            read, in the same critique, as "a foreign object… composited in".
            One voice, sized to fit, breaking where the language breaks.
          */}
          <h1 className="display-serif text-4xl sm:text-5xl md:text-[4.5rem] text-white leading-[1.08] tracking-tight">
            Your personal
            <br />
            auto-ownership consultant
          </h1>
        </motion.div>

        <motion.p
          className="text-xl text-gray-300 leading-relaxed mx-auto mt-6"
          style={{ maxWidth: '600px' }}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.45, ease: 'easeOut' }}
        >
          Well Kept researches your exact year, make and trim — what fails, when it fails, and what
          to bundle so one shop visit does the work of three.
        </motion.p>

        {/*
          Three ways in, in a deliberate order of weight.

          Two things were wrong before. Sign in and sign up were *identical*
          outline pills, giving equal weight to unequal actions — and the nav
          under the door said the opposite, rendering sign-up filled and sign-in
          as plain text. The same pair, two hierarchies, on the same page.

          One hierarchy now, and the nav matches it.

          ── 8 Aug: what that hierarchy is, after the pivot ──────────────────

          iOS is the product; this page is a shop window for it. So the middle
          slot is no longer "sign up" — it is the app. Enrollment happens on the
          phone, where the polished experience is and where the subscription is
          sold.

          `/signup` is *not* deleted, and that is a decision rather than an
          oversight. It is the only way an existing web user reaches the
          companion, and killing it would strand them for no reason Apple's
          rules require — the web sells nothing, so a free account created here
          is outside the in-app-purchase regime entirely. It moves one click
          deeper, to the "Sign up free" link `/login` already carries, which is
          where someone who wants a web account will look. It comes off the
          hero, which is where a new visitor decides what this product is.

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
          {isDemoSite ? (
            /*
              The recruiter host, unchanged. Somebody sent here to look at
              David's work should land in the working product in one tap, and
              asking them to create an account first would be asking the wrong
              person for the wrong thing.
            */
            <button
              onClick={onEnter}
              className="enter-garage-btn group relative flex items-center justify-center gap-2 h-14 px-9 text-base font-semibold text-white rounded-xl overflow-hidden transition-all duration-300 hover:glow-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              /*
                ⚠ One colour, not a gradient. A cyan-to-blue pill is the second
                half of the trope the headline just lost, and its lightest stop
                sat under the first word so the label's contrast was weakest
                exactly where reading starts. `--primary` is the fill every
                other button in the product already uses — the same Sign In
                button on the auth pages — which is what makes this the
                product's primary action rather than the landing page's own.

                ⚠ `hsl(...)` around it. The token holds **raw HSL channels**
                (`193 82% 31%`), not a colour — Tailwind's config wraps it. Set
                bare it resolves to nothing and the button renders with no
                fill at all, which is exactly what happened on the first pass.
              */
              style={{ background: 'hsl(var(--primary))', minWidth: '200px' }}
            >
              <span className="shimmer-layer absolute inset-0 pointer-events-none" aria-hidden="true" />
              <span className="relative z-10 flex items-center gap-2">
                Enter demo
                <ArrowRight className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1.5" />
              </span>
            </button>
          ) : (
            <Link
              href="/signup"
              className="enter-garage-btn group relative flex items-center justify-center gap-2 h-14 px-9 text-base font-semibold text-white rounded-xl overflow-hidden transition-all duration-300 hover:glow-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              /*
                ⚠ One colour, not a gradient. A cyan-to-blue pill is the second
                half of the trope the headline just lost, and its lightest stop
                sat under the first word so the label's contrast was weakest
                exactly where reading starts. `--primary` is the fill every
                other button in the product already uses — the same Sign In
                button on the auth pages — which is what makes this the
                product's primary action rather than the landing page's own.
              */
              style={{ background: 'hsl(var(--primary))', minWidth: '200px' }}
            >
              <span className="shimmer-layer absolute inset-0 pointer-events-none" aria-hidden="true" />
              <span className="relative z-10 flex items-center gap-2">
                Add your vehicle
                <ArrowRight className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1.5" />
              </span>
            </Link>
          )}

          <AppStoreCTA variant="hero" />

          {!isDemoSite && (
            /*
              The demo, demoted to a secondary. Same action as the recruiter
              host's primary — it opens the door — and deliberately worded as
              what it is rather than as a mode you enter. "See a sample garage"
              tells somebody who has not signed up what they are about to look
              at; "Enter demo" tells them what the site is.
            */
            <button
              onClick={onEnter}
              className="flex items-center justify-center h-14 px-7 text-base font-medium text-white/70 hover:text-white rounded-xl border border-white/[0.14] bg-transparent hover:bg-white/[0.06] transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              See a sample garage
            </button>
          )}

          {/*
            ── ⚠ A link, not a third button ─────────────────────────────────

            Three centred buttons at three different widths stacked into what a
            design critique called "a wedding-cake silhouette", and the third
            one was a returning user's utility action taking hero real estate.
            A hero offers two choices: start, or look first.

            Signing in is neither — it is for someone who already decided, and
            they will find it. Same tap target, none of the weight.
          */}
          <Link
            href="/login"
            className="tap-target-44 flex items-center justify-center px-4 text-base font-medium text-white/70 underline decoration-white/25 underline-offset-4 transition-colors hover:text-white hover:decoration-white/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
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
          {/*
            ⚠ Legible, because it is the only path to the pitch.

            A critique: "the disclosure link is a dead end as captured…
            low-contrast gray with a chevron is the only path to substance,
            and it's styled to be missed. If the whole pitch below the hero
            lives behind that toggle, the page's one navigational element is
            its least visible one."

            That is exactly the arrangement — everything explaining the product
            is in this drawer. It stays a disclosure rather than becoming a
            third button, because the hero's two choices are start and look
            first; but a control nobody sees is not restraint.
          */}
          <button
            onClick={() => setDrawerOpen(true)}
            className="tap-target-44 group inline-flex items-center gap-1.5 text-[15px] font-medium text-white/80 hover:text-white underline decoration-white/35 hover:decoration-white decoration-1 underline-offset-[5px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 rounded"
          >
            What Well Kept does
            <ChevronDown className="h-4 w-4 transition-transform duration-300 group-hover:translate-y-0.5" />
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

        /* The gradient-text class and its keyframes are deleted with the
         * gradient headline they drove. A five-second infinite animation left
         * behind for nothing is the shape of thing that gets reattached to
         * something later because it is already there.
         *
         * (No backticks in this block: it is inside a template literal, and a
         * backtick here closes the string mid-comment.) */
      `}</style>

      <FeaturesDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
    </>
  );
}
