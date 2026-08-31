import {
  BRAND_COLOR,
  BRAND_NAME,
  BRAND_TYPE,
  PLATE,
  RIVETS,
  lockupFor,
} from '@wellkept/core/brand';

/**
 * The Well Kept lockup — the backlit coachbuilder plate.
 *
 * ── One component, three drawings, and the caller picks by width ────────────
 *
 * Design's reduction rules are not "scale it down": under 240px the maker line
 * breaks the 12px type floor and has to go, and under 160px there is no lockup
 * left and the icon takes over. `lockupFor` in core owns that, so a caller
 * passing 90px gets the icon rather than a full lockup with 4px maker type.
 *
 * ⚠ **Geometry is imported, never copied.** The plate path, the rivets and the
 * type metrics live in `@wellkept/core/brand` and are asserted against Design's
 * own SVG files by `brand.test.ts`. This project's `Icon.tsx` carries the same
 * rule for Lucide — *"do not redraw or approximate"* — because the old dial
 * mark's path lived in two files and had to be kept in step by eye.
 *
 * ── ⚠ The name is `<text>`, not an outlined path ───────────────────────────
 *
 * Design's package README says to outline the type **for the PNG export**,
 * because a rasteriser without Newsreader silently substitutes Georgia and
 * changes the W. That is an export instruction, not a rendering one: in a
 * browser the webfont is loaded (`app/layout.tsx` links Newsreader 400/500/600),
 * and real text scales, gets selected, and reaches a screen reader.
 *
 * The `aria-label` carries the name regardless, so the accessible name does not
 * depend on the font arriving.
 *
 * ── ⚠ The name never glows; the plate does ─────────────────────────────────
 *
 * Design's rule, and the reason is legibility rather than taste: light the
 * letters and the plate reads as a button somebody should press. The filter is
 * on a copy of the plate path behind it and on nothing else.
 */
export function BrandLockup({
  width = 280,
  variant,
  ground = 'dark',
  className,
}: {
  /** The space available. The drawing is chosen from it unless `variant` says otherwise. */
  width?: number;
  /** Force a drawing. Omit and the width decides — which is the safer default. */
  variant?: 'full' | 'short' | 'icon' | 'mono';
  /**
   * ⚠ `light` is the only sanctioned substitution: the glow cannot exist on a
   * light ground, so the plate goes hollow and the edge takes cyan-700. Never a
   * cyan fill, never a semantic recolour.
   */
  ground?: 'dark' | 'light';
  className?: string;
}) {
  const chosen = variant ?? lockupFor(width);
  const light = ground === 'light';

  const edge = light ? BRAND_COLOR.light.edge : BRAND_COLOR.edge;
  const ink = light ? BRAND_COLOR.light.name : BRAND_COLOR.name;
  const quiet = light ? BRAND_COLOR.light.quiet : BRAND_COLOR.quiet;

  if (chosen === 'mono') {
    /*
      ── The quiet mark ────────────────────────────────────────────────────

      Design ships this as `favicon-mono.svg`: a solid plate in `currentColor`
      with the W knocked out of it. It is the drawing for places where the mark
      is furniture rather than the subject — a loading state, an empty panel,
      a tab bar — and the caller sets the colour by setting `color`.

      ⚠ Its plate is **not** the icon's. At this size the icon's proportions
      close up and the cut corners stop reading as cuts, so the package carries
      a second path with a wider bevel. `brand.test.ts` asserts the two differ,
      which is what stops a later tidy collapsing them into one.
    */
    const plate = PLATE.favicon;
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${plate.width} ${plate.height}`}
        width={width}
        height={width}
        role="img"
        aria-label={BRAND_NAME}
        className={className}
      >
        <path d={plate.path} fill="currentColor" />
        <text
          x={plate.width / 2}
          y={70}
          textAnchor="middle"
          fontFamily="var(--font-display), Newsreader, Georgia, serif"
          fontWeight={600}
          fontSize={56}
          fill={BRAND_COLOR.plate}
        >
          W
        </text>
      </svg>
    );
  }

  if (chosen === 'icon') {
    const plate = PLATE.icon;
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${plate.width} ${plate.height}`}
        width={width}
        height={width}
        role="img"
        aria-label={BRAND_NAME}
        className={className}
      >
        <path
          d={plate.path}
          fill={light ? 'none' : BRAND_COLOR.plate}
          stroke={edge}
          strokeWidth={light ? 3 : 2}
        />
        <text
          x={plate.width / 2}
          y={70}
          textAnchor="middle"
          fontFamily="var(--font-display), Newsreader, Georgia, serif"
          fontWeight={600}
          fontSize={44}
          fill={ink}
        >
          WK
        </text>
      </svg>
    );
  }

  const plate = chosen === 'full' ? PLATE.full : PLATE.short;
  const rivets = chosen === 'full' ? RIVETS.full : RIVETS.short;
  const height = Math.round((width * plate.height) / plate.width);
  const glowId = `wk-glow-${chosen}-${ground}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${plate.width} ${plate.height}`}
      width={width}
      height={height}
      role="img"
      aria-label={chosen === 'full' ? `${BRAND_NAME} by Southmoor Digital` : BRAND_NAME}
      className={className}
    >
      {/*
        The backlight. Absent on light grounds because a glow needs something
        darker than itself to read against — the substitution Design sanctions
        is a hollow plate with a cyan-700 edge, not a dimmer glow.
      */}
      {!light && (
        <>
          <defs>
            <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="10" />
            </filter>
          </defs>
          <g filter={`url(#${glowId})`} opacity={0.55}>
            <path d={plate.path} fill={BRAND_COLOR.glow} />
          </g>
        </>
      )}

      <path
        d={plate.path}
        fill={light ? 'none' : BRAND_COLOR.plate}
        stroke={edge}
        strokeWidth={light ? 3 : 2}
      />

      <g fill={light ? BRAND_COLOR.light.quiet : BRAND_COLOR.rivet}>
        {rivets.map((rivet) => (
          <circle key={`${rivet.x}-${rivet.y}`} cx={rivet.x} cy={rivet.y} r={RIVETS.radius} />
        ))}
      </g>

      <text
        x={plate.width / 2}
        y={BRAND_TYPE.name.baseline[chosen]}
        textAnchor="middle"
        fontFamily="var(--font-display), Newsreader, Georgia, serif"
        fontWeight={BRAND_TYPE.name.weight}
        fontSize={BRAND_TYPE.name.size}
        letterSpacing={BRAND_TYPE.name.tracking}
        fontVariant="small-caps"
        fill={ink}
      >
        {BRAND_NAME}
      </text>

      {chosen === 'full' && (
        <text
          x={plate.width / 2}
          y={BRAND_TYPE.maker.baseline}
          textAnchor="middle"
          fontFamily="Inter, sans-serif"
          fontWeight={BRAND_TYPE.maker.weight}
          fontSize={BRAND_TYPE.maker.size}
          letterSpacing={BRAND_TYPE.maker.tracking}
          fill={quiet}
        >
          {BRAND_TYPE.maker.text}
        </text>
      )}
    </svg>
  );
}

/**
 * The nav treatment: the plate at 28px with the name set beside it.
 *
 * ⚠ Not the plate lockup shrunk. `REBRAND_PROMPT.md` §4.1 specifies a nav as
 * *"the 28px plate mark + Newsreader small caps 19–20px"* — a mark and a
 * wordmark, not one drawing — because a bar is wide and short and the plate's
 * own proportions fight that. Shrinking the lockup to fit a 44px bar would put
 * the name at about 9px inside it.
 *
 * The name is HTML text rather than SVG here, so it inherits the page's font
 * loading and can be selected and read. `BrandLockup` draws the plate.
 */
export function BrandWordmark({
  size = 28,
  ground = 'dark',
  className,
}: {
  size?: number;
  ground?: 'dark' | 'light';
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5${className ? ` ${className}` : ''}`}>
      {/*
        `aria-hidden` on the mark, because the name beside it is real text. Both
        labelled would make a screen reader say "Well Kept Well Kept" — the
        failure the old lockup's docblock names.
      */}
      <span aria-hidden="true" className="inline-flex">
        <BrandLockup width={size} variant="icon" ground={ground} />
      </span>
      <span
        style={{
          fontFamily: 'var(--font-display), Newsreader, Georgia, serif',
          fontWeight: BRAND_TYPE.name.weight,
          fontSize: Math.round(size * 0.7),
          fontVariant: 'small-caps',
          letterSpacing: '0.1em',
          lineHeight: 1,
          color: ground === 'light' ? BRAND_COLOR.light.name : BRAND_COLOR.name,
        }}
      >
        {BRAND_NAME}
      </span>
    </span>
  );
}

export default BrandLockup;
