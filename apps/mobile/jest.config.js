/**
 * The mobile test runner. Separate from the web's, deliberately.
 *
 * ── Why this exists, and why it took until 5 August ─────────────────────────
 *
 * The Phase 3 plan lists it as a day-one ratchet — *"screens render against
 * recorded API fixtures, so a screen test cannot pass by hitting a live server
 * that happens to be up"* — and it was never built. The consequence was
 * measured rather than guessed: on 5 Aug, **nine defects were found by a person
 * tapping a screen and none by the 1,607-test suite.** At least three of them
 * were plain render bugs that this catches in milliseconds — an account button
 * that vanished in the error state, a Health card that could never appear, and
 * an answer that displayed its own markdown.
 *
 * Every mobile suite written before this is a **static source scan** living in
 * the web runner, because that is all the web runner can do with React Native:
 * `jest.config.js` at the root ignores `apps/` and says why — jsdom, the
 * next/jest transform, React 18 types. Those scans are real and have caught
 * real things, but not one of them can see a rendered pixel.
 *
 * ── Why the source scans stay where they are ────────────────────────────────
 *
 * They run on every `npm test` from the repo root, which is what CI and habit
 * both reach for. Moving them here would make them conditional on someone
 * remembering a second command. This runner *adds* the capability that was
 * missing; it does not relocate the one that works.
 */

module.exports = {
  preset: 'jest-expo/ios',

  /*
    React Native and the Expo packages ship untranspiled ESM, so the default
    "ignore everything in node_modules" leaves Jest parsing `import` statements
    it cannot read. This is jest-expo's documented list plus `@crewchief/core`,
    which is a workspace of raw TypeScript rather than a built package.
  */
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@crewchief/core)',
  ],

  moduleNameMapper: {
    // Mirrors the root config's alias. Without it the shared modules resolve
    // to nothing and every screen that imports one fails at collection time.
    '^@crewchief/core/(.*)$': '<rootDir>/../../packages/core/src/$1',

    /*
      npm nested `expo-modules-core` inside `expo` rather than hoisting it, so
      `jest-expo` — which sits a level up — cannot reach it by ordinary
      resolution and fails at setup with "Cannot find module
      'expo-modules-core'". Metro never hits this: it resolves through Expo's
      own autolinking rather than Node's algorithm.

      Pointed at the real path rather than worked around by hoisting, because
      changing where a package physically lives to satisfy a test runner is how
      a working bundler setup gets broken.
    */
    '^expo-modules-core$': '<rootDir>/node_modules/expo/node_modules/expo-modules-core',
    '^expo-modules-core/(.*)$':
      '<rootDir>/node_modules/expo/node_modules/expo-modules-core/$1',

    /*
      `jest-expo`'s preset maps `react` to **`@types/react`** — the type stubs,
      which contain no runtime code — and every mount then fails with
      "Could not locate module react". It resolves React by directory search
      and `@types/react` sorts first in this workspace.

      These two entries win because config-level mappings are matched before
      preset ones. Pointed at the real package rather than deleting
      `@types/react`, which the typecheck needs.
    */
    '^react$': '<rootDir>/node_modules/react',
    '^react/(.*)$': '<rootDir>/node_modules/react/$1',
  },

  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

  // Screens only. The static scans that already cover this app live in the web
  // suite and must not be collected twice.
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.tsx'],
};
