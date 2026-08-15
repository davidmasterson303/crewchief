import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Does this device want motion held back?
 *
 * ── Why this is not just a `useState` + `useEffect` in the gauge ────────────
 *
 * `AccessibilityInfo.isReduceMotionEnabled()` is a **promise**, and the web
 * equivalent this ports from is a synchronous media query. That difference is
 * the whole reason this file exists: a component that starts a needle at 0 and
 * waits for a promise before deciding whether to sweep has a window — usually
 * one frame, occasionally more on a cold start — in which the instrument reads
 * zero while its band label already says "Fair".
 *
 * `ClusterGauge`'s own web comment records finding exactly that failure with
 * `requestAnimationFrame` in a background tab. The shape of the bug is the
 * same here and the fix has to be structural rather than careful.
 *
 * ── The two rules that follow ───────────────────────────────────────────────
 *
 * **1. The preference is resolved once, at import, and cached.** By the time
 * any dial mounts the app has already signed in, fetched a garage and pushed a
 * screen, so the answer is warm and `useState` initialises synchronously with
 * it. No first-mount gap in practice.
 *
 * **2. Unknown is treated as "not reduced", never as "reduced".** This looks
 * backwards for an accessibility preference and is deliberate. A sweep that
 * runs when it should not have *still ends on the reading* — the cost is one
 * unwanted animation. Holding the dial still until the promise resolves costs a
 * needle parked at zero next to a verdict, which is the failure being designed
 * out. When the answer arrives late and says "reduced", the gauge jumps to its
 * end state mid-flight; it never skips to nothing.
 */

let cached: boolean | null = null;

/*
  Warmed at import rather than on first use. This module is imported by both
  instruments, so the request goes out when the bundle evaluates.

  The rejection path matters: a platform that cannot answer must leave the cache
  alone rather than record `false`, so a later query still has a chance.
*/
AccessibilityInfo.isReduceMotionEnabled()
  .then((enabled) => {
    cached = enabled;
  })
  .catch(() => {
    /* Leave `cached` null — see rule 2. Unknown behaves as "not reduced". */
  });

/**
 * `true` only when the device has definitely asked for reduced motion.
 *
 * Callers must land on their end state regardless of what this returns — it
 * chooses *how* a value is reached, never *whether* it is.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(cached === true);

  useEffect(() => {
    let live = true;

    /*
      Re-queried on mount even though the module already asked. The import-time
      request may still be in flight, and this is what closes that gap for the
      first instrument of a session.
    */
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        cached = enabled;
        if (live) setReduced(enabled);
      })
      .catch(() => {});

    /*
      iOS lets the setting change while the app is foregrounded — Control Centre
      and Settings both reach it — and a dial that only read the value at mount
      would keep sweeping for the rest of the session.
    */
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      cached = enabled;
      if (live) setReduced(enabled);
    });

    return () => {
      live = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}
