/**
 * The vehicle hero's geometry, mirrored from `tokens/hero.css`.
 *
 * ── Why these are named exports and not literals at the call site ───────────
 *
 * The handoff is explicit: *"All constants live in `tokens/hero.css`; mirror
 * them into `apps/mobile/src/theme/` … as named exports so both sides read one
 * set of numbers. Do not inline literals at the call site."*
 *
 * The web implementation of the same geometry is in that CSS file. Two clients
 * describing one motion with two sets of numbers is the drift the token layer
 * exists to close, and it is worse here than usual because the numbers are
 * **related to each other** — the title's fade span is chosen against the nav's
 * fade start, and the dial's rate is chosen against the sheet's overlap. Change
 * one in isolation and the design stops holding without anything failing.
 *
 * ── ⚠ The dial is gone, and so is the rule that governed it ────────────────
 *
 * This module opened with a long argument about the health dial's flight: it
 * belonged to neither plane, climbed at 1.6× so it docked before the sheet edge
 * arrived, and crossfaded into a nav chip. That was the hardest part of the
 * design and it worked.
 *
 * It was removed on 23 Aug on David's call: *"the animation is fun but info is
 * redundant and it might cover an important part of the car image people care
 * about."* The photograph is the only place an owner sees their own car, and a
 * 160pt plinth sat over the roofline of most 3:4 phone snapshots.
 *
 * So `HERO_DIAL_RATE`, `dialFlight`, `dialClearsSheet` and the layering
 * invariant are all deleted rather than left dormant. **There is no travelling
 * instrument left to collide with the sheet**, so a guard about that collision
 * would be a test with nothing to fail on — the kind that stays green forever
 * and gets mistaken for coverage. The score lives in the nav chip, which does
 * not move.
 *
 * What remains is the pullback itself: a pinned hero whose contents drift at a
 * third of scroll speed under a sheet that rises over them.
 */

/* ── Rates and spans ──────────────────────────────────────────────────────── */

/** The hero's contents drift at a third of scroll speed. */
export const HERO_PARALLAX_RATE = 0.35;
/** How much the photograph pulls back over the dim's full span. */
export const HERO_SCALE_GAIN = 0.14;
/**
 * The photograph is over-rendered by this much at top and bottom.
 *
 * ⚠ Not optional. RN scales about the centre, so at `HERO_SCALE_GAIN` the image
 * grows ~7% each way — 37pt at the tallest supported hero. Without the bleed
 * the photograph's top edge walks into frame at the end of the drift.
 */
export const HERO_IMAGE_BLEED = 60;
/** How far the sheet rests **onto** the hero at zero scroll. */
export const HERO_SHEET_OVERLAP = 48;

export const HERO_DIM_REST = 0.06;
export const HERO_DIM_MAX = 0.78;
export const HERO_DIM_SPAN = 340;

/**
 * The hero title fades over this, and the nav title arrives at
 * `HERO_NAV_FADE_START`.
 *
 * ⚠ These two are a pair. The hero name must be gone **before** the nav name
 * appears — two legible copies of the same string on one screen is what the
 * stagger avoids. Change one and change the other; `heroTitleClearsNavTitle`
 * exists so a test can hold the relationship rather than the numbers.
 */
export const HERO_TITLE_FADE_SPAN = 210;
export const HERO_NAV_FADE_START = 300;
export const HERO_NAV_FADE_SPAN = 120;

/* ── The frame ────────────────────────────────────────────────────────────── */

/** Below this hero height the plinth and the title stop fitting. See `heroBands`. */
export const HERO_COMPACT_BELOW = 500;

/**
 * Height of the pinned hero. Mirrors `--hero-h: clamp(400, 62svh, 560)`.
 *
 * ⚠ Same shape as `bayHeroHeight` in `BayRoom.tsx` and deliberately different
 * numbers, because the two heroes are different objects: **that one is a room
 * behind a dial and this one is the subject.** The garage bay clamps 168–240
 * because a 164pt instrument has to clear it; this clamps 400–560 because the
 * photograph *is* the screen and the content sheet covers it on demand.
 */
export function detailHeroHeight(windowHeight: number): number {
  return Math.round(Math.min(560, Math.max(400, windowHeight * 0.62)));
}

export interface HeroBands {
  /** `true` on a display too short for the full-size plinth and title. */
  compact: boolean;
  titleSize: number;
  /** Distance from the hero's bottom edge to the identity block's baseline box. */
  titleAnchor: number;
}

/**
 * Which of the two layouts this hero height gets.
 *
 * ── ⚠ A threshold, not a continuous scale ──────────────────────────────────
 *
 * The handoff's reasoning, and it is the part worth keeping: *"a continuously
 * shrinking instrument becomes unreadable somewhere in the middle of its range
 * and nobody notices which display that was. Two sizes can both be checked."*
 *
 * Below `HERO_COMPACT_BELOW` the bands genuinely do not fit — a 4.7″ display
 * gives a 414pt hero, where a 160pt plinth ends at 318 and a two-line 36pt
 * title anchored 86 off the bottom starts at 224. They overlap by 94pt and no
 * nudging fixes it, because the content is taller than the frame.
 *
 * ⚠ In practice only the 4.7″ display takes the compact branch. The mini
 * (812pt → 503) clears the threshold by 3pt, which is worth knowing before
 * anyone edits the clamp in `detailHeroHeight`.
 */
export function heroBands(heroHeight: number): HeroBands {
  const compact = heroHeight < HERO_COMPACT_BELOW;

  return compact
    ? {
        compact,
        titleSize: 28,
        titleAnchor: 66,
      }
    : {
        compact,
        titleSize: 36,
        titleAnchor: 86,
      };
}

/**
 * True when the hero's own title is gone before the nav's arrives.
 *
 * The pair `HERO_TITLE_FADE_SPAN` / `HERO_NAV_FADE_START` states the intent;
 * this states the *relationship*, so a test can hold it while either number
 * moves. Two legible copies of one car's name on one screen is the failure.
 */
export function heroTitleClearsNavTitle(): boolean {
  return HERO_TITLE_FADE_SPAN < HERO_NAV_FADE_START;
}
