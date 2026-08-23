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
 * ── The one rule to read before touching the dial ───────────────────────────
 *
 * ⚠ **The dial is chrome, not scenery, and that is why it does not share the
 * hero's parallax rate.** It belongs to neither plane: it starts over the
 * photograph and ends in the nav bar, so it sits above the sheet the whole way.
 * Two failure modes, both live in the exploration build:
 *
 *   - hero's rate + above the sheet → it floats over the first content card
 *     like a sticker.
 *   - hero's depth → the sheet swallows it mid-flight.
 *
 * The fix is the **rate**, not the z-index: at `HERO_DIAL_RATE` it climbs about
 * five times faster than the hero drifts, so it is docked and out of the way
 * long before the sheet edge arrives.
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

/** See the ⚠ in the header. Five times the hero's drift, and deliberately so. */
export const HERO_DIAL_RATE = 1.6;
/** The dial's scale once docked. It crossfades to a chip rather than reaching 0. */
export const HERO_DIAL_DOCK_SCALE = 0.34;
/** Travel over which the dial hands off to the chip. */
export const HERO_DIAL_FADE_SPAN = 180;

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
  dialVariant: 'hero' | 'card';
  dialSize: number;
  plinthHeight: number;
  /** Plinth centre as a fraction of the hero's height. */
  dialStart: number;
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
        dialVariant: 'card',
        dialSize: 104,
        plinthHeight: 124,
        dialStart: 0.43,
        titleSize: 28,
        titleAnchor: 66,
      }
    : {
        compact,
        /*
          132, not `HERO_SIZE` (184). One dial per screen is the hero, and on
          this screen the hero is the photograph — the same argument
          `GarageBay.tsx` already makes for 164 rather than 184 there.
        */
        dialVariant: 'hero',
        dialSize: 132,
        plinthHeight: 160,
        dialStart: 0.46,
        titleSize: 36,
        titleAnchor: 86,
      };
}

/**
 * How tall the identity block is, so a caller can ask where its top edge lands.
 *
 * Two lines of title plus the mileage line and the gap between them. Two lines
 * rather than one because that is the case the compact branch exists for — a
 * name that wraps is the one that collides with the plinth, and sizing this
 * against the single-line case would make the clearance test pass on the names
 * that were never the problem.
 */
export function identityBlockHeight(bands: HeroBands): number {
  const titleLine = bands.titleSize * 1.05;
  const mileageLine = 20;
  const gap = 8;
  return Math.round(titleLine * 2 + mileageLine + gap);
}

/* ── The dial's flight ────────────────────────────────────────────────────── */

export interface DialFlight {
  /** Where the plinth's centre sits at rest, from the hero's top edge. */
  restY: number;
  /** Where it comes to rest in the nav row. */
  dockY: number;
  /** Scroll offset at which it arrives. Everything after this is the chip. */
  dockAt: number;
  /** Scroll offsets for `k` = 1 and `k` = 0 — the handoff's fade parameter. */
  fullAt: number;
  /** Scroll offsets where the dial's own opacity leaves 1 and reaches 0. */
  fadeFrom: number;
  fadeTo: number;
  /** Where the verdict label under the numeral gives up. */
  verdictFrom: number;
  verdictTo: number;
  /** Where the docked chip starts appearing. */
  chipFrom: number;
}

/**
 * The dial's whole journey, as scroll offsets.
 *
 * ── Why this is a function and not a pile of `interpolate` calls ────────────
 *
 * The handoff expresses the dial in terms of `k`, a fade parameter derived from
 * the dial's own position: `k = clamp((cy - dockY) / 180, 0, 1)`. That is the
 * right way to *describe* it and the wrong way to *drive* it, because RN's
 * native driver interpolates from one `Animated.Value` — the scroll offset —
 * and cannot chain a clamp through a second derived value.
 *
 * So every threshold is converted back into the scroll offset that produces it.
 * The formulas are unchanged; only the variable they are expressed in is. That
 * conversion is exactly the kind of arithmetic that is wrong silently, which is
 * why it lives here with tests on it rather than inline in a `style` prop.
 */
export function dialFlight(heroHeight: number, safeTop: number): DialFlight {
  const bands = heroBands(heroHeight);

  const restY = heroHeight * bands.dialStart;
  const dockY = safeTop + 22;

  /** Total travel, and the distance `k` is measured over. */
  const travel = Math.max(0, restY - dockY);

  /** The scroll offset at which the dial's centre reaches a given `k`. */
  const atK = (k: number) => Math.max(0, (travel - k * HERO_DIAL_FADE_SPAN) / HERO_DIAL_RATE);

  return {
    restY,
    dockY,
    dockAt: atK(0),
    fullAt: atK(1),
    // opacity = clamp(3k - 0.15, 0, 1): full at k = 0.3833, gone at k = 0.05.
    fadeFrom: atK(1 / 3 + 0.05),
    fadeTo: atK(0.05),
    // verdict = clamp(2.4k - 1.1, 0, 1): full at k = 0.875, gone at k = 0.4583.
    verdictFrom: atK(0.875),
    verdictTo: atK(1.1 / 2.4),
    // chip = clamp(1 - 3k, 0, 1): starts at k = 1/3, full at k = 0.
    chipFrom: atK(1 / 3),
  };
}

/**
 * Where the sheet's leading edge sits at a given scroll offset.
 *
 * The sheet is the only thing that travels, so this is simply its rest position
 * less the scroll — but naming it means the layering invariant can be asserted
 * against the same expression the screen lays out from.
 */
export function sheetEdgeAt(heroHeight: number, y: number): number {
  return heroHeight - HERO_SHEET_OVERLAP - y;
}

/**
 * ⚠ **The regression that matters.** True when the dial has finished docking
 * before the sheet's edge reaches its lower boundary.
 *
 * This was wrong twice in the design's own exploration, in both directions, and
 * it is not visible in a screenshot — it only appears mid-scroll, on one device
 * size, with the right content height. `VehicleDetailScreen.test.tsx` holds it
 * at the shortest and tallest supported windows.
 */
export function dialClearsSheet(windowHeight: number, safeTop: number): boolean {
  const heroHeight = detailHeroHeight(windowHeight);
  const bands = heroBands(heroHeight);
  const flight = dialFlight(heroHeight, safeTop);

  const dialBottomAtDock = flight.dockY + bands.plinthHeight / 2;
  return sheetEdgeAt(heroHeight, flight.dockAt) > dialBottomAtDock;
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
