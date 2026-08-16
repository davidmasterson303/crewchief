/**
 * A control that swaps its label for a spinner still has a name.
 *
 * @jest-environment node
 *
 * The pattern is everywhere in this app and it is the right pattern:
 *
 *     <Pressable onPress={submit}>
 *       {busy ? <ActivityIndicator /> : <Text>Create account</Text>}
 *     </Pressable>
 *
 * React Native derives a control's accessible name from its `<Text>`
 * descendants when no `accessibilityLabel` is given. So the button above is
 * announced as "Create account" — right up until it is pressed, at which point
 * the `<Text>` is replaced by a spinner and **the control becomes an unnamed
 * button.** VoiceOver reads it as just "button".
 *
 * That is the wrong moment to lose the name. Someone who cannot see the
 * spinner has no other signal that anything is happening, and the one control
 * that could tell them has just gone quiet. `accessibilityState.busy` is how
 * "working" is announced, and it needs something to be working *on*.
 *
 * Found on 8 Aug on the two controls that matter most: `SignInScreen`'s submit
 * — the front door, and the only way to become a user since the pivot — and
 * `AccountScreen`'s delete, which is App Store guideline 5.1.1(v)'s own
 * affordance.
 *
 * ── Why a source scan ───────────────────────────────────────────────────────
 *
 * A render test would need to catch the component mid-flight, in the busy
 * state, on every screen — and the states that reach it are the ones behind a
 * mocked network. The property is structural: does this `Pressable` name
 * itself, given that its text can disappear. That is on disk.
 *
 * Registered in `STATIC_ANALYSIS_SUITES`, like every other mobile scan, because
 * it imports nothing — the subject is React Native source this runner cannot
 * load.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCREENS = join(__dirname, '..', '..', 'apps', 'mobile', 'src', 'screens');

function screenFiles(): string[] {
  return readdirSync(SCREENS).filter((f) => f.endsWith('.tsx'));
}

/**
 * Each `<Pressable …>` opening tag paired with the block it encloses.
 *
 * Deliberately crude — it takes everything up to the next `</Pressable>` — and
 * that is safe in the direction that matters. Over-reading the block can only
 * make this scan *more* likely to find an `ActivityIndicator` and demand a
 * label; it cannot hide one. A guard whose parser errs toward false positives
 * is one that gets fixed; the other kind is one that gets trusted.
 */
function pressables(source: string): Array<{ line: number; block: string }> {
  const found: Array<{ line: number; block: string }> = [];
  let index = source.indexOf('<Pressable');

  while (index !== -1) {
    const close = source.indexOf('</Pressable>', index);
    const end = close === -1 ? source.length : close;
    found.push({ line: source.slice(0, index).split('\n').length, block: source.slice(index, end) });
    index = source.indexOf('<Pressable', index + 1);
  }

  return found;
}

const offenders = screenFiles().flatMap((file) => {
  const source = readFileSync(join(SCREENS, file), 'utf8');

  return pressables(source)
    .filter(({ block }) => block.includes('<ActivityIndicator'))
    .filter(({ block }) => !block.includes('accessibilityLabel'))
    .map(({ line }) => `${file}:${line}`);
});

describe('a busy control keeps its name', () => {
  it('still watches something, and names where the guarantee now lives', () => {
    /*
      Guards the guard — but it had to move on 16 Aug, and the reason is the
      good kind.

      This used to require **more than one** hand-rolled busy `Pressable` to
      exist, on the reasoning that a walk which silently stopped matching would
      make the rule below trivially true. That was right while every screen
      rolled its own control. Step 5 finished moving them onto `Button`, and the
      count fell to one — so the anti-vacuous check failed while the app was
      getting *better*.

      Lowering the threshold would have been the wrong repair: it would leave
      the guard pointed at a population that is on its way to zero. The
      guarantee now lives in the primitive, so that is what this asserts —
      `Button` shows a spinner and keeps an accessible name through it — plus
      the stragglers the scan can still see.
    */
    const spinners = screenFiles().flatMap((file) =>
      pressables(readFileSync(join(SCREENS, file), 'utf8')).filter(({ block }) =>
        block.includes('<ActivityIndicator')
      )
    );

    const button = readFileSync(
      join(__dirname, '..', '..', 'apps', 'mobile', 'src', 'components', 'Button.tsx'),
      'utf8'
    );

    expect(button).toMatch(/<ActivityIndicator/);
    expect(button).toMatch(/accessibilityLabel=\{accessibilityLabel \?\? label\}/);

    // The walk itself still finds real controls; zero would mean it broke.
    expect(spinners.length).toBeGreaterThanOrEqual(1);
  });

  it('every Pressable that can show a spinner carries an accessibilityLabel', () => {
    /*
      To fix one: add `accessibilityLabel` naming the action — the same words
      the `<Text>` uses — and put `busy` in `accessibilityState`. Do not remove
      the spinner; it is the right affordance for everyone who can see it. The
      label is what makes it work for everyone who cannot.
    */
    expect(offenders).toEqual([]);
  });
});
