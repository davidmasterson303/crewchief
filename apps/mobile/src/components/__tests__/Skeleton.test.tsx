import { AccessibilityInfo } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { Skeleton, SkeletonCard } from '../Skeleton';

/**
 * The placeholder that stands in for content on a cold fetch.
 *
 * ── Why this is its own file and not part of `primitives.test.tsx` ──────────
 *
 * `motion/reduced-motion.ts` caches the device preference in a **module-level**
 * variable, warmed at import. That is right for the app — by the time a dial
 * mounts the answer is warm, so there is no frame where a needle sits at zero
 * next to a verdict — and it makes the module stateful across tests within a
 * file. Jest gives each *file* a fresh module registry, so a suite of its own
 * keeps that state out of the twenty-odd primitives that have no animation.
 *
 * ⚠ **One mount per test, deliberately.** Two in a single test leaks: the
 * second one's `isReduceMotionEnabled()` promise resolves after the test that
 * made it and queues React work outside anyone's act scope, which is what
 * `jest.setup.js` throws on. It threw here first, on the version of this file
 * that measured both cases together.
 */

/**
 * Mount a bar, let the preference resolve, and read the opacity React committed.
 *
 * ⚠ The `rerender` is load-bearing, not a paranoia flush: the effect that reads
 * the preference runs *after* the commit that set it, so the first tree still
 * carries the declared value.
 *
 * ⚠ And this is why 0.4 is evidence of a *running* pulse rather than evidence
 * of nothing. The loop uses `useNativeDriver`, so it never writes back into the
 * JS tree — an animating bar sits at its declared 0.4 here forever. The only
 * thing in this component that can move this number is the guard's `setValue`,
 * which makes the two cases distinguishable precisely because the native driver
 * is silent.
 */
async function settledOpacity(reduceMotion: boolean): Promise<number> {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(reduceMotion);

  const view = await render(<Skeleton width="60%" />);
  await act(async () => {});
  await view.rerender(<Skeleton width="60%" />);

  /*
    `JsonElement`'s props are `Record<string, any>`, so the shape has to be
    asserted through `unknown`. Narrow rather than blanket-cast: the failure
    this could hide — a null tree from a leaked act scope — is caught by the
    assertion itself, since `undefined` matches neither 0.4 nor 0.9.
  */
  const bar = view.toJSON() as unknown as { props: { style: { opacity: number } } };
  const opacity = bar.props.style.opacity;

  await view.unmount();
  return opacity;
}

describe('the pulse answers to the device', () => {
  /*
    ⚠ This was the **one animation in the app with no guard** — an
    unconditional `Animated.loop`, on the screens a reviewer opens first, while
    the dials, the bay door and the build needle all checked the preference
    correctly. Found by an external design audit on 16 Aug, not by anything in
    here.

    Unreduced runs first on purpose: the preference cache starts empty and each
    render warms it, so checking the reduced case first would leave `true`
    behind and the other test would begin from the wrong initial state.
  */
  it('pulses when nothing has been asked for', async () => {
    expect(await settledOpacity(false)).toBe(0.4);
  });

  it('settles and holds when reduced motion is on', async () => {
    /*
      0.9 — the **bright** end. A static placeholder at 0.4 reads as a disabled
      control; at 0.9 it reads as content that has not arrived, which is what it
      is.

      ⚠ **What this does not claim: that no loop ever starts.** On the first
      skeleton of a session the cache is still empty, so the hook returns
      `false`, a loop starts, and it is stopped a tick later when the promise
      resolves — one frame of pulse on a device that asked for none. An earlier
      version of this file asserted `Animated.loop` was never called and failed
      here, which is how that came to light.

      It is rule 2 of `reduced-motion.ts` working as written: unknown behaves as
      "not reduced", because an animation that should not have run still ends on
      the right value, whereas holding still costs a needle parked at zero next
      to a verdict. The cost is one frame, once, on a screen about to be
      replaced by content. Recorded here so the next person to tighten the guard
      meets a decision rather than a surprise.
    */
    expect(await settledOpacity(true)).toBe(0.9);
  });

});

describe('what a screen reader is told', () => {
  it('announces once for the group, not once per bar', async () => {
    // Eight identical "loading" bars read aloud in sequence is worse than
    // silence, so the bars are hidden and the card carries the single name.
    const view = await render(<SkeletonCard lines={3} />);

    expect(view.getAllByLabelText('Loading')).toHaveLength(1);
    await view.unmount();
  });

  it('says it is busy, so the name is not mistaken for content', async () => {
    const view = await render(<SkeletonCard lines={2} />);

    expect(view.getByLabelText('Loading').props.accessibilityRole).toBe('progressbar');
    await view.unmount();
  });
});
