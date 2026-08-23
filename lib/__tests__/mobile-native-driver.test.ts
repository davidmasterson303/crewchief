/**
 * Every scroll-linked value drives a transform or an opacity.
 *
 * @jest-environment node
 *
 * ── The failure this catches, which has no symptom on a simulator ───────────
 *
 * `HERO_PULLBACK_PROMPT.md` §4.1: *"All of them are `transform` or `opacity`,
 * which is exactly the set the native driver supports — **do not** drive
 * `height`, `top`, or a colour from this. If a value you want needs the JS
 * driver, you have chosen the wrong value."*
 *
 * An `Animated.event` declared with `useNativeDriver: true` and then fed into a
 * `height` does not throw at build time. It throws **at runtime, on a device,
 * the first time the value is read** — and on a desktop simulator with a small
 * photograph the whole hero runs at 60fps on the JS thread anyway, so the
 * regression is invisible exactly where it is most likely to be introduced.
 *
 * ── Why a source scan and not a render test ─────────────────────────────────
 *
 * The property is structural: *which style key does this interpolation land
 * on*. By the time RNTL renders the tree the animated values have been resolved
 * to plain numbers, so the association between an `interpolate` and its key is
 * gone. It is on disk, and it is decidable there.
 *
 * The handoff asks for this as a screen test; it lives here instead because
 * that is where every other mobile source scan in this repository lives —
 * `mobile-color-literals`, `mobile-type-floor`, `mobile-font-faces` — and they
 * all run on `npm test` from the root without a React Native runtime.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { HERO_PARALLAX_RATE } from '../../apps/mobile/src/theme/hero-motion';

const MOBILE_SRC = join(__dirname, '..', '..', 'apps', 'mobile', 'src');

/**
 * The style keys the native driver can animate.
 *
 * `transform` and `opacity` are the documented pair. `shadowOpacity` is
 * included because it is an opacity by another name and RN's iOS shadow props
 * are animatable natively; if that ever stops being true the sheet's shadow is
 * the one call site to revisit.
 */
const NATIVE_KEYS = new Set([
  'transform',
  'opacity',
  'shadowOpacity',
  /*
    The transform's own sub-keys. `transform: [{ scale: photoScale }]` puts the
    animated value under `scale`, not under `transform`, so a scan that only
    allowed the outer key would flag every legitimate transform in the app.
  */
  'translateX',
  'translateY',
  'scale',
  'scaleX',
  'scaleY',
  'rotate',
  'rotateX',
  'rotateY',
  'rotateZ',
  'perspective',
  'skewX',
  'skewY',
]);

function sourceFiles(dir: string, acc: { rel: string; code: string }[] = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') sourceFiles(full, acc);
    } else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) {
      acc.push({
        rel: full.slice(full.indexOf(join('apps', 'mobile'))),
        code: readFileSync(full, 'utf8'),
      });
    }
  }
  return acc;
}

/** Comments quote these constantly; they must not trip the rule. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Names bound to an `.interpolate(...)` call.
 *
 * `const dialFade = scrollY.interpolate({...})` → `dialFade`. Anything animated
 * inline at the style site is caught separately below.
 */
function interpolatedNames(code: string): string[] {
  return Array.from(
    code.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*[\w.]*\.interpolate\s*\(/g),
    (match) => match[1]
  );
}

/** Every `key: value` in the file where `value` mentions one of `names`. */
function keysUsing(code: string, names: string[]): string[] {
  if (names.length === 0) return [];

  const alternation = names.map((n) => n.replace(/[$]/g, '\\$')).join('|');
  /*
    ⚠ `(?<![.\w$])` — the name must stand alone, not be a property of something
    else. Without it `hero.sheetShadow` matches the animated value named
    `sheetShadow` and reports `shadowColor` as a violation, which is a colour
    token that never animates. Caught on this scan's first run.
  */
  const pattern = new RegExp(
    `([A-Za-z_$][\\w$]*)\\s*:\\s*([^,;\\n}]*(?<![.\\w$])(?:${alternation})\\b[^,;\\n}]*)`,
    'g'
  );

  return Array.from(code.matchAll(pattern), (match) => match[1]);
}

describe('scroll-linked values are native-driver safe', () => {
  const files = sourceFiles(MOBILE_SRC).map((f) => ({ ...f, code: stripComments(f.code) }));

  const animated = files.filter((f) => /useNativeDriver:\s*true/.test(f.code));

  it('has files declaring a native-driven animation', () => {
    /*
      Anti-vacuous, and it has teeth: if the hero's `Animated.event` were ever
      renamed or removed, every assertion below would pass against nothing —
      which is exactly how a guard ends up green while checking a screen that no
      longer exists.
    */
    expect(animated.length).toBeGreaterThan(0);
    expect(animated.some((f) => f.rel.includes('VehicleDetailScreen'))).toBe(true);
  });

  it('lands every interpolation on a transform or an opacity', () => {
    const offenders: string[] = [];

    for (const file of animated) {
      const names = interpolatedNames(file.code);
      if (names.length === 0) continue;

      for (const key of keysUsing(file.code, names)) {
        /*
          `inputRange` / `outputRange` are the interpolation's own arguments and
          `style` is the array the value is placed into — neither is a style key
          the driver has to animate.
        */
        if (['inputRange', 'outputRange', 'style'].includes(key)) continue;
        if (!NATIVE_KEYS.has(key)) offenders.push(`${file.rel} — ${key}`);
      }
    }

    expect(Array.from(new Set(offenders))).toEqual([]);
  });

  it('reads its rates from the constants module, never from a literal', () => {
    /*
      §3 of the handoff: *"All constants live in `tokens/hero.css`; mirror them
      into `apps/mobile/src/theme/` … Do not inline literals at the call site."*

      Two clients describe one motion, and the numbers are chosen against each
      other — the dial's rate against the sheet's overlap, the title's fade
      against the nav's. A literal at a call site is how one of them moves alone.

      ⚠ Also the reason this suite imports shipped code at all:
      `tests-test-real-code` requires it, and it is right to — a source scan
      that imports nothing can drift into checking a path that no longer exists.
    */
    const screen = files.find((f) => f.rel.includes('VehicleDetailScreen'))!;

    expect(screen.code).toMatch(/from '\.\.\/theme\/hero-motion'/);
    /*
      ⚠ `HERO_DIAL_RATE` used to be asserted here too — the 1.6× climb against
      the hero's 0.35 drift, which was the layering fix. The dial was removed on
      23 Aug because it covered the car, so there is one rate left and the
      claim is now simply that it is not spelled out at the call site.
    */
    expect(HERO_PARALLAX_RATE).toBeGreaterThan(0);
    expect(screen.code).not.toMatch(new RegExp(`\\b${HERO_PARALLAX_RATE}\\b`));
  });

  it('can still detect a value driven into a layout key', () => {
    /*
      §5 of `CLAUDE.md`. The check run against a planted violation, so a
      regex that stopped matching cannot pass silently.
    */
    const planted = `
      const heroLift = scrollY.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
      const s = { height: heroLift, opacity: heroLift };
    `;
    const names = interpolatedNames(planted);
    const keys = keysUsing(planted, names).filter(
      (k) => !['inputRange', 'outputRange', 'style'].includes(k)
    );

    expect(names).toContain('heroLift');
    expect(keys).toContain('height');
    expect(keys.filter((k) => !NATIVE_KEYS.has(k))).toEqual(['height']);
  });
});
