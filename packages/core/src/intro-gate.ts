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
 * How long the door sits closed before it lifts, in milliseconds.
 *
 * **Must exceed {@link INTRO_PANEL_SETTLED_MS}, and visibly.** At 900ms it did
 * not, and the intro was reported as "faint, quick and buggy" — correctly. The
 * panel's own entrance ran to 1220ms, so the lift began while three of its four
 * elements were still fading *in*. Two opposing opacity animations composited:
 * the headline held full brightness for 50ms, and the paragraph, the buttons
 * and the test-drive link never reached it at all. Nothing was mistimed by a
 * little; the curtain was leaving before the content had arrived.
 *
 * The gap between the two is the dwell — the beat where the door is simply a
 * door with legible words on it, which is the entire point of having one.
 *
 * The original value was 600ms, measured from the *page's* mount while the
 * curtain arrived in a separately-loaded chunk, so on a slow load it fired
 * before the curtain existed and the intro silently never rendered. That race
 * is gone. This number is kept here, beside the thing it must clear, rather
 * than inlined in a component where the relationship is invisible.
 */
export const INTRO_HOLD_MS = 1800;

/**
 * When the panel on the door has finished arriving.
 *
 * The last of `LandingHero`'s staggered entrances, delay plus duration. Kept
 * here so {@link INTRO_HOLD_MS} can be checked against it by a test instead of
 * by whoever next edits one of the two.
 */
export const INTRO_PANEL_SETTLED_MS = 700;

/** How long the panel is fully legible before the door starts to move. */
export const INTRO_DWELL_MS = INTRO_HOLD_MS - INTRO_PANEL_SETTLED_MS;

/** Duration of the lift itself. Must match `--intro-lift-ms` in globals.css. */
export const INTRO_LIFT_MS = 1500;

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
