/**
 * Babel, for the test runner.
 *
 * ── Why this file did not exist until now ───────────────────────────────────
 *
 * Metro never needed it. Expo SDK 50+ resolves `babel-preset-expo` implicitly
 * when bundling, so the app has been building, running and shipping without a
 * Babel config at all.
 *
 * Jest does not get that. It hands files to `babel-jest`, which reads a real
 * config or applies nothing — and applying nothing means React Native's own
 * `jest-preset/jest/setup.js` arrives full of Flow annotations that Babel then
 * refuses to parse:
 *
 *     SyntaxError: Unexpected token, expected ","
 *       value(id: TimeoutID): void {
 *
 * That error names a file inside React Native and reads like a broken
 * dependency. It is neither: it is the absence of this file.
 *
 * `babel-preset-expo` strips Flow, compiles JSX and applies the React Native
 * transforms. It was not previously a declared dependency for the same reason
 * this config was missing — Metro supplied it without being asked.
 *
 * **Adding it does not change how the app is bundled.** Metro was already using
 * this preset; the config now says so out loud, which is the difference between
 * a build that works and a build whose behaviour is inherited from a default
 * that could change.
 */

module.exports = function babelConfig(api) {
  // Expo's preset is expensive to construct and identical across files.
  api.cache(true);

  return {
    presets: ['babel-preset-expo'],
  };
};
