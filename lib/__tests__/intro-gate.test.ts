/**
 * The garage-door intro plays once, and stops playing for good reasons.
 *
 * Every condition here corresponds to a way the previous implementation
 * actually failed, so these are regression tests rather than a specification
 * written after the fact:
 *
 *   - `alreadyPlayed` — `LandingHero` had no gate at all and ran its curtain
 *     on every single visit to /demo.
 *   - `reducedMotion` — it never checked, despite the comment above the
 *     reduced-motion block in globals.css stating that JS-driven effects must
 *     check `matchMedia` themselves, because the CSS override cannot reach
 *     them. Its curtain was driven by framer-motion, which is JS.
 *   - `documentHidden` — a full-screen fixed curtain whose animation is
 *     throttled mid-flight stays parked over the page. Observed on the
 *     predecessor: loading /demo in a hidden browser pane left it frozen 5%
 *     into a 1.5s lift, indefinitely.
 *
 * The timing constants are asserted too. They look like trivia until you note
 * that `GarageDoorAnimation` fired its completion callback on a hand-copied
 * 1200ms timer against a 1500ms CSS animation — 300ms early, every time,
 * because the two numbers lived in different files with nothing tying them
 * together.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decideIntro,
  INTRO_DWELL_MS,
  INTRO_HOLD_MS,
  INTRO_LIFT_MS,
  INTRO_LIFT_TIMEOUT_MS,
  INTRO_PANEL_SETTLED_MS,
  INTRO_PLAYED_KEY,
  INTRO_PLAYED_VALUE,
  type IntroConditions,
} from '@crewchief/core/intro-gate';

/** Nothing standing in the way: the case that should actually animate. */
const FIRST_LOAD: IntroConditions = {
  alreadyPlayed: false,
  reducedMotion: false,
  documentHidden: false,
};

describe('deciding whether the intro plays', () => {
  it('plays on a first load in a visible tab with motion allowed', () => {
    expect(decideIntro(FIRST_LOAD)).toBe('play');
  });

  it.each([
    ['it has already played this session', { alreadyPlayed: true }],
    ['the visitor prefers reduced motion', { reducedMotion: true }],
    ['the tab is hidden', { documentHidden: true }],
  ] as const)('skips when %s', (_reason, override) => {
    expect(decideIntro({ ...FIRST_LOAD, ...override })).toBe('skip');
  });

  it('skips when several reasons apply at once', () => {
    // Guards against a future rewrite into early returns getting the
    // precedence wrong: no combination may resolve back to 'play'.
    expect(
      decideIntro({ alreadyPlayed: true, reducedMotion: true, documentHidden: true })
    ).toBe('skip');
  });

  it('has exactly one input combination that plays', () => {
    /*
      Exhaustive over all eight combinations, which is cheap at three booleans
      and is the assertion that actually pins the policy down. Adding a fourth
      reason to `decideIntro` without updating this test fails here rather than
      passing quietly, because the count changes.
    */
    const bools = [false, true];
    const playing = bools.flatMap((alreadyPlayed) =>
      bools.flatMap((reducedMotion) =>
        bools
          .map((documentHidden) => ({ alreadyPlayed, reducedMotion, documentHidden }))
          .filter((conditions) => decideIntro(conditions) === 'play')
      )
    );

    expect(playing).toEqual([FIRST_LOAD]);
  });
});

describe('the storage contract the pre-paint script depends on', () => {
  /*
    app/layout.tsx interpolates both of these into an inline <script> string —
    it cannot import them, because it has to run before the bundle exists. If
    either changes shape, that script silently stops recognising a session that
    has already seen the intro, and it replays on every navigation.
  */
  it('is session-scoped and namespaced', () => {
    expect(INTRO_PLAYED_KEY).toBe('cc_intro_played');
  });

  it('uses a value safe to embed in a single-quoted script literal', () => {
    expect(INTRO_PLAYED_VALUE).toBe('1');
    expect(INTRO_PLAYED_VALUE).not.toMatch(/['"\\<]/);
  });

  it('uses a key safe to embed in a single-quoted script literal', () => {
    expect(INTRO_PLAYED_KEY).not.toMatch(/['"\\<]/);
  });
});

describe('the intro timings', () => {
  it('declares the same lift duration the stylesheet animates for', () => {
    /*
      The one assertion in this file that reaches outside the module, and the
      reason it exists: INTRO_LIFT_MS is a TypeScript constant, the animation
      that it describes is a CSS rule, and nothing in the language ties them
      together. That is precisely the gap GarageDoorAnimation fell into — a
      1200ms timer chasing a 1500ms animation, in two files, for as long as the
      component existed.

      Reading the stylesheet is uglier than trusting a comment and is the only
      thing that actually fails when the two drift apart.
    */
    const css = readFileSync(join(__dirname, '..', '..', 'app', 'globals.css'), 'utf8');
    const lift = css.match(/\.garage-door\.is-lifting\s*\{[^}]*?animation:[^;]*?\s(\d+)ms/);

    expect(lift).not.toBeNull();
    expect(Number(lift![1])).toBe(INTRO_LIFT_MS);
  });

  it('lets the panel finish arriving before the door starts leaving', () => {
    /*
      The relationship that was wrong, and the reason the intro was reported as
      faint and buggy: the hold was 900ms while the panel's entrance ran to
      1220ms, so the door began lifting — fading the panel out — while three of
      its four elements were still fading in. Opposing opacity animations
      composite, so they simply never got bright.

      A whole second of dwell rather than a hair's breadth, because the failure
      mode of getting this wrong is not a jitter; it is content that can never
      be read.
    */
    expect(INTRO_HOLD_MS).toBeGreaterThan(INTRO_PANEL_SETTLED_MS);
    expect(INTRO_DWELL_MS).toBeGreaterThanOrEqual(1000);
  });

  it('is matched by every entrance in the panel it waits for', () => {
    /*
      The other half. INTRO_PANEL_SETTLED_MS is a claim about a file it cannot
      see, so it is checked against that file: every framer-motion transition in
      LandingHero must land inside the budget. Adding one more staggered element
      with a late delay is the natural way to reintroduce the bug, and it fails
      here rather than looking merely dim in a browser.
    */
    const hero = readFileSync(join(__dirname, '..', '..', 'components', 'LandingHero.tsx'), 'utf8');

    // `exec` in a loop rather than spreading `matchAll`: this project targets
    // es5, where spreading an iterator needs downlevelIteration.
    const pattern = /delay:\s*([\d.]+),\s*duration:\s*([\d.]+)/g;
    const transitions: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(hero)) !== null) {
      transitions.push(Math.round((Number(match[1]) + Number(match[2])) * 1000));
    }

    // Guards the guard: a rewrite away from framer-motion would otherwise make
    // this pass against an empty list.
    expect(transitions.length).toBeGreaterThanOrEqual(4);

    expect(transitions.filter((end) => end > INTRO_PANEL_SETTLED_MS)).toEqual([]);
  });

  it('gives the lift longer to finish than the lift takes', () => {
    // The 1200-against-1500 bug, asserted so it cannot return: the fallback
    // teardown must never be what ends a running animation.
    expect(INTRO_LIFT_TIMEOUT_MS).toBeGreaterThan(INTRO_LIFT_MS);
  });

  it('keeps the whole intro under three and a half seconds', () => {
    /*
      The annoyance budget, raised from 2500ms once the dwell was real.

      It was not raised to accommodate a slow animation — the lift is unchanged.
      It was raised because the old ceiling was being met by *skipping the part
      that matters*: a door nobody can read the words on is not a shorter intro,
      it is a broken one. This runs once per session and can be dismissed with
      the button on it.
    */
    expect(INTRO_HOLD_MS + INTRO_LIFT_MS).toBeLessThanOrEqual(3500);
  });
});
