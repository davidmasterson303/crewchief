/**
 * The mobile token layer — CrewChief v8, native.
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
 * owned by `@crewchief/core/health-band` and read at runtime, not stored here.
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
  /**
   * Light-on-dark inversion, for a control that has to outrank everything.
   * Used sparingly and never for two controls on one screen.
   */
  inverse: '#FFFFFF',
  /** A disabled inverse control. Keeps its ink near 9:1 while reading as off. */
  inverseDisabled: '#B8B8B8',
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
  /** Ink on the filled primary. 5.10:1 on `brand.primary`. */
  onPrimary: '#F2FBFD',
  /** Ink on `surface.inverse`. */
  onInverse: '#080808',
  /**
   * Secondary ink on `surface.inverse`.
   *
   * 0.60, not 0.55. The comment that shipped with this claimed 8.6:1 and had
   * measured white-on-white by mistake; the real figure was 4.47:1, a hair
   * under the floor, and no source scan could catch it because the ink is
   * dark. The rendered suite found it. 0.60 gives 5.35:1.
   */
  onInverseMuted: 'rgba(8,8,8,0.6)',
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
 * by `@crewchief/core/health-band` and read at runtime. `attention` and
 * `critical` below are the *banner* families and happen to share hues with two
 * bands; they are not a second copy of the ramp, and a build reading must never
 * be coloured from either — a low build is stock, not a fault.
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
  attention: '#E0A468',
  critical: '#E08882',
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
  attentionWash: 'rgba(251,191,36,0.08)',
  attentionWashBorder: 'rgba(251,191,36,0.35)',
  /** Behind a modal. */
  scrim: 'rgba(0,0,0,0.4)',
} as const;

/** Build continuum paint. Zone selection lives in `@crewchief/core/build-progress`. */
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
   * ⚠ The serif face is not loaded in the native app yet — there is no font
   * asset in `apps/mobile`, and adding one is a native change that costs an EAS
   * build. Until then this is the system sans at editorial weight, which is
   * also exactly what the sport register specifies ("tight heavy Inter"), so
   * sport is already correct and standard is the one waiting on the font.
   */
  editorial: { fontSize: 26, lineHeight: 32, fontWeight: '700' as const, letterSpacing: -0.5 },
  /** 18 — screen titles and hero copy. */
  title: { fontSize: 18, lineHeight: 24, fontWeight: '700' as const },
  /** 16 — body. */
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' as const },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const },
  /** 14 — UI: buttons, rows, nav. */
  ui: { fontSize: 14, lineHeight: 20, fontWeight: '500' as const },
  uiStrong: { fontSize: 14, lineHeight: 20, fontWeight: '600' as const },
  /** 13 — a value. Tabular wherever it is data. */
  value: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  /** 12 — the word that names a value. The type floor. */
  label: { fontSize: 12, lineHeight: 16, fontWeight: '600' as const, letterSpacing: 0.6 },
} as const;

/**
 * Tabular figures, for anything that is data.
 *
 * Mileage, scores, prices and dates must not reflow as their digits change —
 * a value that shifts sideways while it updates reads as a glitch.
 */
export const TABULAR = { fontVariant: ['tabular-nums' as const] };

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
  border,
  text,
  brand,
  register,
  status,
  build,
  space,
  radius,
  type,
} as const;
