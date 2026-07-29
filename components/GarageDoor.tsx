'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type AnimationEvent,
  type ReactNode,
} from 'react';
import {
  decideIntro,
  INTRO_LIFT_TIMEOUT_MS,
  INTRO_PLAYED_KEY,
  INTRO_PLAYED_VALUE,
  type IntroDecision,
} from '@crewchief/core/intro-gate';

/**
 * The first-load intro curtain: a garage door that lifts to reveal the page.
 *
 * Replaces three things that did not work together. `GarageDoorAnimation` and
 * `GarageDoorLayer` were dead code on every branch — the second rendered
 * `children` twice, concurrently, for the whole 1.5s of its exit, so the entire
 * page below it mounted twice with duplicate effects and duplicate fetches. The
 * third, `LandingHero`, was live but ran its curtain on every visit, from a
 * 1.41 MB JPEG, with no reduced-motion check.
 *
 * Three rules hold this one together:
 *
 *   1. **`children` is rendered exactly once**, and never inside the curtain.
 *      The page below is the page below whether the door is up or not; the
 *      curtain is a sibling that covers it. That is the fix for the double
 *      mount, and it is structural rather than careful.
 *   2. **The curtain is server-rendered and CSS-gated**, so it covers the
 *      viewport in the first paint. Nothing about it waits on a chunk. The old
 *      version was `dynamic(..., { ssr: false })` racing a 600ms timer, and
 *      lost the race silently — no error, just no intro.
 *   3. **The lift ends on `animationend`**, not on a hand-copied duration.
 */

interface GarageDoorProps {
  /**
   * What sits on the door — headline, calls to action. Optional: the door is
   * complete without it.
   *
   * A render prop rather than a node, so the panel can raise the door early
   * (an "Enter Garage" button) without knowing how the door works, and without
   * the parent having to hold a piece of the door's state to pass back down.
   * That shared `isOpen`-in-the-parent arrangement is what let the old version
   * get out of step with itself.
   */
  panel?: (enter: () => void) => ReactNode;
  /** The page. Rendered once, always, whatever the door is doing. */
  children: ReactNode;
}

type Phase = 'closed' | 'lifting' | 'gone';

/**
 * A layout effect on the client, an ordinary one on the server.
 *
 * The decision has to land *before* the browser paints. A passive `useEffect`
 * runs after paint, so a load that skips the intro would show one frame of
 * door and then remove it — invisible on a first load, where the intro is
 * playing anyway, and a clear flicker on every client-side navigation back to
 * a door-bearing route, where it is not.
 *
 * `useLayoutEffect` warns when it runs during server rendering, hence the
 * switch rather than using it directly.
 */
const useIntroDecisionEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

function markPlayed() {
  // Written when the intro *starts*, not when it finishes. A reload halfway
  // through is a person who has seen it and would rather not sit through it
  // again, and it also stops a fast double-refresh replaying it twice.
  try {
    sessionStorage.setItem(INTRO_PLAYED_KEY, INTRO_PLAYED_VALUE);
  } catch (_) {
    // Storage can be unavailable outright (partitioned or blocked contexts).
    // The intro then plays once per load rather than once per session, which
    // is a worse experience but not a broken one.
  }
}

export default function GarageDoor({ panel, children }: GarageDoorProps) {
  /*
    Starts 'closed' on the server and on the client's first render, so
    hydration matches. Whether that markup is *visible* is decided by CSS from
    the `data-intro` attribute the pre-paint script in app/layout.tsx sets —
    which is how a returning visitor gets no flash of door despite the door
    being in the server's HTML.
  */
  const [phase, setPhase] = useState<Phase>('closed');
  /*
    Decided once per mounted instance, and this ref is what makes that true.

    React Strict Mode — on by default for the App Router, so every development
    load — mounts, runs effects, tears them down and mounts again. Without this,
    the first pass wrote the "already played" flag and the second pass read it
    back, concluded the intro had run, and removed the curtain. The door could
    therefore never appear in development, while every unit test of the policy
    stayed green, because the policy was never what was wrong.

    An effect that writes the state it reads is not idempotent. Strict Mode
    exists to surface exactly that, and it did.
  */
  const decision = useRef<IntroDecision | null>(null);

  const lift = useCallback(() => {
    setPhase((current) => (current === 'closed' ? 'lifting' : current));
  }, []);

  useIntroDecisionEffect(() => {
    if (decision.current === null) {
      /*
        Session storage is the source of truth, not the `data-intro` attribute
        the pre-paint script wrote.

        Preferring that attribute is what broke the demo link. The script runs
        once per *document load*; `next/link` navigates on the client and never
        re-runs it, so the attribute still says "play" long after the intro has
        finished. Every client-side navigation back to a door-bearing route
        therefore raised a second curtain — pressing a link and being met by
        another closed garage door, which reads as a dead link.

        The two cannot disagree within a load anyway: the script computes its
        answer before `markPlayed()` has run, so it reads the same unplayed flag
        this does. The attribute's job is narrower than it was given — it exists
        so CSS can hide the server-rendered curtain before the first paint, and
        that is all it does now.
      */
      decision.current = decideIntro({
        alreadyPlayed: (() => {
          try {
            return sessionStorage.getItem(INTRO_PLAYED_KEY) === INTRO_PLAYED_VALUE;
          } catch (_) {
            return false;
          }
        })(),
        reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
        documentHidden: document.hidden,
      });

      if (decision.current === 'play') markPlayed();
    }

    if (decision.current === 'skip') setPhase('gone');

    /*
      And then it waits.

      There is deliberately no timer here. The door opened by itself on a hold
      of a few hundred milliseconds, which made the button on it ornamental —
      you watched a thing happen rather than doing it. A garage door opens
      because someone pressed the opener, and the panel already carries the
      opener. Nothing about the intro should proceed without the visitor.
    */
  }, []);

  /*
    The safety net, armed only once the door is actually moving.

    `animationend` is the right signal and cannot be the only one: it never
    arrives if the animation is interrupted, or if the tab is hidden partway
    through. The predecessor was found frozen 5% into its lift, parked over the
    page indefinitely, because a stalled animation had nothing else to end it.

    Armed on entering `lifting` rather than at mount, now that the door may sit
    closed for as long as the visitor likes.
  */
  useEffect(() => {
    if (phase !== 'lifting') return;
    const timer = setTimeout(() => setPhase('gone'), INTRO_LIFT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const handleAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    // Only the door's own lift ends the intro. Without this guard any
    // animation on any descendant would tear the curtain down early — and the
    // panel's call-to-action carries a shimmer.
    if (event.target !== event.currentTarget) return;
    setPhase('gone');
  };

  return (
    <>
      {children}

      {phase !== 'gone' && (
        <div
          className={`garage-door fixed inset-0 z-50 flex-col items-center justify-center overflow-hidden${
            phase === 'lifting' ? ' is-lifting' : ''
          }`}
          onAnimationEnd={handleAnimationEnd}
        >
          {panel && (
            <div className="garage-door-content relative z-10 flex w-full flex-col items-center px-6 text-center">
              {panel(lift)}
            </div>
          )}
        </div>
      )}
    </>
  );
}
