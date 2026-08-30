import { EDITORIAL_FACE, interFace } from './fonts';

/**
 * The mobile token layer — Well Kept v8, native.
 *
 * Source: `HANDOFF_mobile_baseline.md` (14 Aug) and the `Mobile Baseline`
 * board, cross-checked against `app/globals.css`. **Nothing here is invented
 * for mobile.** Where a value could be read off the repository it was, and
 * where the handoff and the tree disagreed the tree won — that rule caught two
 * claims in the board's first draft, both describing the design-system export
 * rather than this codebase.
 *
 * ── The rule this file exists to make enforceable ───────────────────────────
 *
 * `$rules.colorLiterals`: **no StyleSheet in `apps/mobile` may contain a colour
 * literal**, including a computed or conditional one. Twelve screens carried
 * 232 of them, which is why nothing about the app could be reviewed — a screen
 * cannot be judged when every screen is a different product.
 *
 * The one legitimate exception is a colour the *data* chooses: a health band is
 * owned by `@wellkept/core/health-band` and read at runtime, not stored here.
 * The phone must not hold a second opinion about what "Fair" looks like.
 */

/**
 * ── Surfaces ────────────────────────────────────────────────────────────────
 *
 * ⚠ **`page` is `#100F0D`, the warm graphite — not `#080808`.**
 *
 * That literal appeared 27 times in this app and was the single most visible
 * way the two clients looked like two products: web sits on a warm dark with a
 * five-step ladder, mobile sat on a flat neutral black with no ladder at all.
 * Depth on web is not decoration, it is the ladder doing its job.
 *
 * The ladder matters more than any single value. A card on a panel on the page
 * needs three steps that separate without a border, which is what stops a
 * screen reading as a list of text on black.
 */
export const surface = {
  /** The page. Web `--background`. */
  page: '#100F0D',
  /** Nav and headers. Web `--surface-nav`. */
  nav: '#0E0D0B',
  /** Raised bars, tab strips, chips. Web `--surface-1`. */
  raised: '#1A1815',
  /** Cards and panels. Web `--card`. */
  card: '#201D19',
  /** Wells, inputs, the estimate block. Web `--secondary`. */
  well: '#262220',
  /** Disabled fills. Never a group opacity — see `text.disabled`. */
  disabled: '#1B1917',
  /*
    ⚠ **There is no `inverse` here any more, and that is the point.**

    `#FFFFFF` and its `#B8B8B8` disabled partner were a second filled treatment
    — a white control for a verb that had to outrank everything. It was against
    the readme's override register (*"a white button is a foreign colour
    here"*), and by 23 Aug the app had white CTAs on six screens and the cyan
    fill on one, so the screens disagreed about what a primary action looks
    like.

    The tokens are **deleted rather than left unused**, for the same reason
    `status.critical` was: a dead token holding a retired treatment is how the
    treatment comes back, one call site at a time, with its argument already
    written beside it. There is one filled control in this app and it is
    `brand.primary`.
  */
} as const;

export const border = {
  /** Cards and panels. */
  panel: 'rgba(255,255,255,0.08)',
  /** Fields at rest. */
  field: 'rgba(255,255,255,0.14)',
  /** Fields under the finger. */
  fieldHover: 'rgba(255,255,255,0.24)',
} as const;

/**
 * ── Text ────────────────────────────────────────────────────────────────────
 *
 * ⚠ **`muted` at 50% is the floor for any string.** There is deliberately no
 * token between it and `nonText`, because "just one step quieter" is exactly
 * how a system accumulates off-token sites.
 *
 * `nonText` at 40% measures 3.78:1 and is a **hairline token, never a word** —
 * dividers, rules, tick marks. If it is carrying language, it is wrong.
 */
export const text = {
  primary: '#F5F3F0',
  secondary: 'rgba(255,255,255,0.72)',
  /** The quietest a string may be. */
  muted: 'rgba(255,255,255,0.5)',
  /** Hairlines and rules only. 3.78:1 — not for text. */
  nonText: 'rgba(255,255,255,0.4)',
  /** Disabled ink. Exempt from the floor under WCAG 1.4.3. */
  disabled: '#6E6B67',
  /** Ink on the filled primary — the only filled control. 5.10:1 on `brand.primary`. */
  onPrimary: '#F2FBFD',
  /*
    `onInverse` and `onInverseMuted` went with `surface.inverse` on 23 Aug — see
    its note above. Worth keeping the finding they cost: `onInverseMuted` shipped
    at 0.55 with a comment claiming 8.6:1, which had **measured white on white**
    by mistake. The real figure was 4.47:1, under the floor, and no source scan
    could catch it because the ink is dark. The rendered suite found it. Any
    future light-on-dark pair needs measuring the same way rather than reasoning
    about.
  */
} as const;

/**
 * ── The filled primary, and why pressed goes *down* ─────────────────────────
 *
 * The board's first draft sent pressed **up** the ramp to `#0891B2` on the
 * reading that a lit switch gets brighter. It fails: under `#F2FBFD` ink that
 * is **3.51:1**, and it is the exact hex v8 removed at 3.68:1.
 *
 * The cause is structural rather than a bad pick — with near-white ink,
 * lighter always means less contrast, so "brighter" cannot be spent on the
 * fill. Pressed deepens to `#0C6580` (6.27:1): a switch pressed into a panel is
 * recessed and reads darker, and the lit reading stays where the system already
 * puts it, in the glow on the CTA.
 */
export const brand = {
  primary: '#0E7490',
  primaryPressed: '#0C6580',
  /** Accent and glow. Web `--accent`, cyan-400. */
  accent: '#22D3EE',
} as const;

/**
 * ── The register, as tokens and nothing else ────────────────────────────────
 *
 * The rule is that **no component may branch on register**. One theme scope,
 * token overrides only — that is how the cost of carrying two treatments stops
 * being permanent, and it is why this is a token rather than a `variant` prop
 * threaded through the instruments.
 *
 * `accent` is web's `--register-accent`, which resolves to `--info` in the
 * default register and to `--build-far` under `.register-sport`. Only the
 * standard value is here because the phone has no sport scope yet; when it gets
 * one, this object is what changes and no component moves.
 *
 * ⚠ The amber the sport register uses is `build.far`, and it is already in this
 * file. Reaching for it directly to "preview sport" is the branch this rule
 * exists to prevent.
 */
export const register = {
  /** Web `--register-accent` in the default register — `--info`. */
  accent: '#8FB4C4',
} as const;

/**
 * Status colours.
 *
 * ⚠ **The health band is not here.** Thresholds, wording and colour are owned
 * by `@wellkept/core/health-band` and read at runtime.
 *
 * ── ⚠ 23 Aug: "happen to share hues" was doing a lot of work ────────────────
 *
 * This docblock used to say `attention` and `critical` "happen to share hues
 * with two bands". They did not share hues — they were **the same hex**:
 * `attention` was `#E0A468`, which is the health ramp's `warn`, and `critical`
 * was `#E08882`, which is its `bad`. So the sentence asserting these were not a
 * second copy of the ramp sat directly above a second copy of the ramp.
 *
 * Design's ruling: **attention is `#FB923C`**, and the two families are meant to
 * rhyme without matching, because a gauge reading and a status chip are
 * different claims — sharing a colour makes a 61 look like something you can
 * dismiss. The garage bay had that live: a dial reading in warn amber with a
 * recall chip beside it in the same amber the dial uses for Critical.
 *
 * `critical: '#E08882'` is **gone** rather than recoloured. It had no call
 * sites — the critical chip reads `dangerText` (`#F87171`, which is already the
 * system's value) and the banners read `criticalFill`/`criticalBorder`. A dead
 * token holding a colliding hex is how a collision comes back.
 *
 * A build reading must still never be coloured from either — a low build is
 * stock, not a fault.
 */
export const status = {
  confirm: '#4ADE80',
  /**
   * Fill behind a success banner, as opposed to `confirm` which is ink.
   *
   * This app's own shipped value — web has no equivalent banner — kept because
   * `contrast.test.tsx` already measures white on it. Folds into the
   * `AlertBanner` primitive in step 2 and should not gain a second caller
   * before then.
   */
  confirmFill: 'rgba(22,163,74,0.95)',
  /** Design's value, 23 Aug. Not the health ramp's `warn` — see the docblock. */
  attention: '#FB923C',
  danger: '#DC2626',
  dangerText: '#F87171',
  /** Pressed danger. Deepens, for the same reason the primary does. */
  dangerPressed: '#B91C1C',

  /**
   * ── Banner pairs ──────────────────────────────────────────────────────────
   *
   * Solid fills, never a tinted transparency. These carry the only
   * time-critical instructions in the product — a do-not-drive recall, a
   * park-outside warning — and a wash over an unknown backdrop is exactly where
   * the 4.47:1 defect came from on the advisor CTA.
   *
   * Both pairs are this app's own measured values, kept rather than re-derived
   * because `mobile-text-contrast.test.ts` already measures white on them. They
   * become the `AlertBanner` primitive's `critical` and `attention` tones in
   * step 2 and should gain no other caller.
   */
  criticalFill: '#4A0F0F',
  criticalBorder: '#7F1D1D',
  attentionFill: '#4A3308',
  attentionBorder: '#854D0E',
  /** Danger edge on a field that failed validation. */
  dangerBorder: '#8C4B4B',
  /**
   * Soft tones, for a notice that is informative rather than time-critical.
   *
   * Distinct from the solid banner pairs above on purpose: a wash is fine when
   * the message can wait, and wrong when it cannot.
   */
  dangerWash: 'rgba(248,113,113,0.06)',
  dangerWashBorder: 'rgba(248,113,113,0.3)',
  /*
    ⚠ The wash follows the ink. It was `rgba(251,191,36,…)` — amber-400, a
    **third** amber in a family that is supposed to have one — so a chip drew
    orange type on a yellow tint. The system's own pair is the default hue at
    0.14 / 0.35, and that is what these are now.

    The solid `attentionFill` / `attentionBorder` above are deliberately *not*
    re-derived: they are this app's own measured values and the contrast scan
    already measures white on them. That override is documented and stays.
  */
  attentionWash: 'rgba(251,146,60,0.14)',
  attentionWashBorder: 'rgba(251,146,60,0.35)',
  /** Behind a modal. */
  scrim: 'rgba(0,0,0,0.4)',
} as const;

/**
 * ── The bay ─────────────────────────────────────────────────────────────────
 *
 * The garage is a car in a lit room, not a row in a list. Two of these three
 * values are the only genuinely new colours in this file — the room's own
 * gradient — and they come from the baseline board rather than from
 * `globals.css`, because web has no bay at this scale to read them off.
 *
 * ⚠ `light` is `brand.accent`, not a fourth value. The board writes it as
 * `--bay-light-hot`, which is an export-side token with no equivalent in this
 * repo; its rendered value is the accent cyan the app already carries. Naming a
 * second copy here is how two cyans start drifting.
 */
export const bay = {
  /** The lit end of the room, up near the ceiling. */
  roomNear: '#2A2724',
  /** The far, unlit end. */
  roomFar: '#111214',
  /** The batten and the pool of light under the dial. Aliases `brand.accent`. */
  light: brand.accent,
} as const;

/**
 * ── The vehicle hero ────────────────────────────────────────────────────────
 *
 * The pinned photograph on the vehicle screen, and the two layers that make
 * type over it legal. Mirrored from `tokens/hero.css`; the motion constants
 * live beside them in `theme/hero-motion.ts`.
 *
 * ⚠ `shadow` is **not** `bay.roomFar` and not `surface.nav`. It is the design's
 * own `#08090B` — a colder, deeper black than anything on the surface ladder,
 * chosen because it is going *over* a photograph rather than sitting beside
 * other surfaces. Reaching for `surface.nav` here would tint the dim warm and
 * make a dark car look brown as the floor comes up.
 */
export const hero = {
  /**
   * The dim, and the bed gradient's darkest stop.
   *
   * ⚠ The bed's floor is this at **0.95**, and that figure is load-bearing
   * beyond the visual: it is what `contrast.test.tsx` samples the hero's name
   * and mileage against, rather than the photograph. See `HeroBed`.
   */
  shadow: '#08090B',
  /**
   * The floating back and settings pills, at rest over the photograph.
   *
   * A solid fill, never a blur. There is no glassmorphism anywhere in this
   * product — `plinth` carries the case that already tried it.
   */
  pill: 'rgba(22,21,19,0.78)',
  /**
   * The shadow the sheet casts up onto the car as the floor arrives.
   *
   * Pure black, not `hero.shadow` — this is a cast shadow rather than a dim,
   * so it must not carry the dim's slight blue. `tokens/hero.css` writes it as
   * `rgb(0 0 0 / …)` and the opacity is the animated part.
   *
   * ⚠ It is a token rather than a literal because `$rules.colorLiterals` admits
   * no exception for shadows, and it is right not to: a shadow colour is the
   * kind of thing that gets nudged to "#111" on one screen and stays.
   */
  sheetShadow: '#000000',
} as const;

/**
 * ── The plinth ──────────────────────────────────────────────────────────────
 *
 * The block the hero dial stands on. It is the page colour at 92% — `fill` is
 * `surface.page` with an alpha, not a fourth grey — so it reads as a slab cut
 * from the same material rather than a card floating on it.
 *
 * ⚠ **No blur anywhere near it.** The 92% is what makes it look like glass, and
 * it must stay a flat fill: a real backdrop blur would cost a native module,
 * would drop frames under a sweeping needle, and — the actual reason — an
 * unknown blurred backdrop is precisely where the 1.09:1 advisor button came
 * from. A plinth whose contrast depends on what happens to be behind it is not
 * a surface, it is a hazard.
 */
export const plinth = {
  /** `surface.page` at 0.92. Same material, standing proud of it. */
  fill: 'rgba(16,15,13,0.92)',
  /** 1px edge. Lighter than `border.panel` because the slab has a lit top. */
  edge: 'rgba(255,255,255,0.09)',
  /** The inset catch-light along the top edge — a milled edge, not a shadow. */
  catchLight: 'rgba(255,255,255,0.16)',
} as const;

/** Build continuum paint. Zone selection lives in `@wellkept/core/build-progress`. */
export const build = {
  stock: '#7D8794',
  mild: '#9FC8D8',
  warm: '#E0C168',
  far: '#F0A35E',
  redline: '#FF4436',
} as const;

/**
 * 4pt spacing scale.
 *
 * **11, 13, 15, 22 and 68 are off-scale** and were all in use. Six arbitrary
 * paddings across twelve screens is most of why nothing lined up.
 */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  h1: 32,
  h2: 40,
  h3: 48,
  h4: 64,
} as const;

/** **9, 10 and 16 do not exist.** */
export const radius = {
  /** Wells and fields. */
  well: 8,
  /** Buttons. */
  button: 12,
  /** Cards, panels, modals. */
  card: 14,
  /** Hero photo and the identity plate. */
  hero: 20,
  pill: 999,
} as const;

/**
 * ── Type ────────────────────────────────────────────────────────────────────
 *
 * The scale is a set of *roles*, not sizes to pick from: **12 names a value,
 * 13 is a value, 14 is UI, 16/18 are body.** Nothing else exists.
 *
 * `lineHeight` is stated everywhere rather than left to the platform. React
 * Native's default leading is tighter than the browser's, and that alone is why
 * identical copy reads cramped on the phone and comfortable on web.
 */
export const type = {
  /**
   * The one editorial role per screen — a vehicle's name, a screen's title.
   *
   * Not in the handoff's four-size list because it is a *role*, not a UI size:
   * "Newsreader for one serif role per screen". **One per screen, never two.**
   *
   * ✅ **The serif is bundled as of 16 Aug** — `Newsreader_700Bold`, loaded by
   * `useFonts` in `App.tsx`. This docblock previously said it was not, and that
   * the change would cost an EAS build; the build is now the same one that
   * carries the first TestFlight upload, so the two costs merged.
   *
   * Only the 700 cut ships, because this is a single-weight role by definition.
   * A second cut would be a second editorial role arriving by the back door.
   */
  editorial: {
    fontFamily: EDITORIAL_FACE,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700' as const,
    letterSpacing: -0.5,
  },
  /** 18 — screen titles and hero copy. */
  title: { fontFamily: interFace('700'), fontSize: 18, lineHeight: 24, fontWeight: '700' as const },
  /** 16 — body. */
  body: { fontFamily: interFace('400'), fontSize: 16, lineHeight: 22, fontWeight: '400' as const },
  bodyStrong: {
    fontFamily: interFace('600'),
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600' as const,
  },
  /** 14 — UI: buttons, rows, nav. */
  ui: { fontFamily: interFace('500'), fontSize: 14, lineHeight: 20, fontWeight: '500' as const },
  uiStrong: {
    fontFamily: interFace('600'),
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600' as const,
  },
  /** 13 — a value. Tabular wherever it is data. */
  value: { fontFamily: interFace('400'), fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  /** 12 — the word that names a value. The type floor. */
  label: {
    fontFamily: interFace('600'),
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600' as const,
    letterSpacing: 0.6,
  },
} as const;

/**
 * Tabular figures, for anything that is data.
 *
 * Mileage, scores, prices and dates must not reflow as their digits change —
 * a value that shifts sideways while it updates reads as a glitch.
 */
export const TABULAR = { fontVariant: ['tabular-nums' as const] };

/**
 * ── R56 · the vertical rhythm, pinned ───────────────────────────────────────
 *
 * Measured across the ten screens in the v8.3 review: the page gutter varied
 * between 16 and 24, the gap between cards between 6 and 16, and the space
 * under a section label between 8 and 14 — all of it written as raw numbers at
 * each screen. Nothing was wrong on any single screen; what was wrong was that
 * moving between two of them felt like moving between two products.
 *
 * Every value here already existed in `space`. What did not exist was a name
 * for **which slot each one belongs to**, which is the only part a screen can
 * get wrong by accident: `padding: 20` on one body and `padding: 24` on the
 * next is not a disagreement about the scale, it is two people picking off it
 * independently.
 *
 * ⚠ Spread these rather than re-deriving them. `gap: space.md` in a screen is
 * indistinguishable from `gap: 12` six months later; `...rhythm.cardGap` says
 * which decision is being made and moves when the decision moves.
 */
export const rhythm = {
  /** The page gutter, both edges. Every screen body. */
  page: 16,
  /** Nav bottom → the first element on the page. */
  afterNav: 20,
  /** A section label → the first card under it. */
  afterLabel: 12,
  /** Card → card. Also list row → list row. */
  betweenCards: 12,
  /** A card's own inset. */
  cardPad: 16,
  /** A card's title → its body. */
  afterTitle: 8,
  /** The last card → the safe area. Long enough to read as an end. */
  tail: 32,
} as const;

/**
 * The page body, as one spread: gutter, tail, and the gap between cards.
 *
 * The shape almost every `contentContainerStyle` in this app wants, so that the
 * three numbers are not re-chosen per screen.
 */
export const PAGE_BODY = {
  paddingHorizontal: rhythm.page,
  paddingTop: rhythm.afterNav,
  paddingBottom: rhythm.tail,
  gap: rhythm.betweenCards,
} as const;

/**
 * ── R57 · where a short screen's content sits ───────────────────────────────
 *
 * Four screens in the v8.3 review were **more than half empty with everything
 * pinned to the top** — Scan an invoice, Service due, the empty wishlist and
 * the advisor. A single-question screen with its question at the very top of a
 * black field reads as a page that failed to finish loading, and on Service due
 * the keyboard then strands it further.
 *
 * The rule, and it is one rule rather than four judgements: **content shorter
 * than the display is centred optically; content that scrolls is top-aligned.**
 * `flexGrow: 1` with `justifyContent: 'center'` is exactly that behaviour for
 * free — the container only has slack to distribute when the content is short,
 * so a list that overflows is unaffected and never has to be special-cased.
 *
 * ⚠ **Optically centred, not mathematically.** `paddingBottom` biases the block
 * about a tenth of the display above true centre, which is where the eye reads
 * "centred" — dead centre reads as low. The same reason a wordmark sits above
 * the middle of a page.
 *
 * Spread into a `contentContainerStyle`, never applied to a `ScrollView`'s own
 * `style`: on the container it distributes the content, on the view it does
 * nothing and looks like it should have.
 */
export const OPTICAL_CENTRE = {
  flexGrow: 1,
  justifyContent: 'center' as const,
  paddingBottom: 72,
};

/** ── Floors. All four are lintable. ─────────────────────────────────────── */

/** Any interactive target. `hitSlop` is not a substitute in a wrapped row. */
export const TARGET_MIN = 44;
/** Any focusable field on touch — under it iOS zooms and never zooms back. */
export const FIELD_FONT_MIN = 16;
/** The smallest rendered text. */
export const TYPE_MIN = 12;

/**
 * Below this a dial stops being a dial.
 *
 * Under ~88pt the ticks stop resolving and the instrument is decoration. Row
 * scale is a 30pt tabular numeral plus the verdict at 12, both in the band
 * colour — no ticks, no needle.
 */
export const DIAL_MIN = 88;

export const theme = {
  surface,
  hero,
  border,
  text,
  brand,
  register,
  bay,
  plinth,
  status,
  build,
  space,
  radius,
  type,
} as const;
