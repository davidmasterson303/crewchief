/**
 * Whether the garage-door intro plays on this load. No DOM, no storage.
 *
 * Reading session storage, the motion preference and the page's visibility is
 * glue, and lives in the browser — `components/GarageDoor.tsx` and the
 * pre-paint script in `app/layout.tsx`. The *policy* is here, because it is
 * the part that can be wrong in ways nobody notices: an intro that replays on every
 * navigation reads as a bug to the user but as working code to the developer
 * who has already dismissed it once and can no longer see it.
 *
 * The previous attempt had no policy at all. `LandingHero` ran its curtain on
 * every single visit to `/demo`, and the two dead components it grew out of
 * (`GarageDoorAnimation`, `GarageDoorLayer`) disagreed with each other about
 * whether `isOpen` meant "the door is up" or "the door is showing".
 */

/**
 * Session-scoped, deliberately.
 *
 * `localStorage` would show the intro once per device ever, which sounds
 * kinder and is worse in one specific way: the person maintaining it stops
 * being able to see it. Closing the tab is a discoverable reset;
 * "clear site data" is not.
 */
export const INTRO_PLAYED_KEY = 'cc_intro_played';

/** Written under {@link INTRO_PLAYED_KEY}. Any other value counts as unplayed. */
export const INTRO_PLAYED_VALUE = '1';

export type IntroDecision = 'play' | 'skip';

export interface IntroConditions {
  /** `sessionStorage` already carries {@link INTRO_PLAYED_KEY}. */
  alreadyPlayed: boolean;
  /** `prefers-reduced-motion: reduce` is set. */
  reducedMotion: boolean;
  /**
   * The page was not visible at the moment of the decision.
   *
   * Not theoretical, and not the same worry as the two above.
   * `hooks/use-scroll-reveal.ts` documents finding that an
   * IntersectionObserver never fires in a background tab; the sibling problem
   * here is that a full-screen fixed curtain whose animation is throttled
   * mid-flight stays parked over the page. Verified on this component's
   * predecessor: loading `/demo` in a hidden browser pane left the curtain
   * frozen 5% into its 1.5s exit indefinitely, covering everything.
   *
   * So a load that begins hidden does not get an intro at all. Skipping costs
   * an animation nobody was looking at. Playing costs the page.
   */
  documentHidden: boolean;
}

/**
 * The whole policy, in one place.
 *
 * Order does not matter — every condition points the same way — but the
 * function is written as a single disjunction rather than a chain of early
 * returns so that adding a fourth reason cannot accidentally shadow a third.
 */
export function decideIntro({
  alreadyPlayed,
  reducedMotion,
  documentHidden,
}: IntroConditions): IntroDecision {
  return alreadyPlayed || reducedMotion || documentHidden ? 'skip' : 'play';
}

/**
 * When the panel on the door has finished arriving.
 *
 * The last of `LandingHero`'s staggered entrances, delay plus duration.
 *
 * It matters because the panel carries the button that opens the door, and a
 * control that is still fading in is a control you cannot press. It briefly did
 * not hold: the entrance ran to 1220ms against a hold of 900ms, so the lift
 * began while three of the four elements were still arriving. Two opposing
 * opacity animations composited and the panel simply never got bright.
 *
 * Kept here rather than inlined in the component so a test can check the
 * component against it, instead of whoever next edits one of the two.
 */
export const INTRO_PANEL_SETTLED_MS = 700;

/**
 * Duration of the lift. Must match the animation in globals.css, which a test
 * checks by reading the stylesheet.
 *
 * 2600ms, up from 1500ms, because "garage doors don't open that fast" and they
 * do not. A domestic opener takes ten to fifteen seconds for a full door, which
 * is unusable here — but the honest constraint is not speed, it is that the
 * travel has to read as machinery hauling weight rather than a panel sliding.
 * The keyframes carry the rest of that: a settle as the motor takes the load,
 * and a near-linear middle, because a chain drive does not accelerate through
 * its whole travel.
 *
 * It is affordable now in a way it was not before. The door no longer opens on
 * a timer, so this is time the visitor asked for by pressing the opener, not
 * time spent waiting on a page that will not get out of the way.
 */
export const INTRO_LIFT_MS = 2600;

/**
 * When to give up waiting for `animationend` and tear the curtain down anyway.
 *
 * `GarageDoorAnimation` used a bare 1200ms timer against a 1500ms animation,
 * so it called back 300ms early, every time. Listening for `animationend` is
 * the fix; this is the belt to its braces, because `animationend` does not
 * arrive if the tab is hidden or the animation is interrupted. Generous on
 * purpose — it should never be the thing that ends a visible animation.
 */
export const INTRO_LIFT_TIMEOUT_MS = INTRO_LIFT_MS + 750;
