/**
 * Metro, taught where the monorepo keeps its packages.
 *
 * Two problems to solve, and the obvious fix for the second breaks the first.
 *
 * ── 1. Finding the workspace ────────────────────────────────────────────────
 *
 * Metro does not follow npm workspace symlinks on its own. Without
 * `watchFolders` it neither resolves `@crewchief/core` nor notices when it
 * changes, so an edit to shared logic would silently not reach the phone.
 *
 * ── 2. Two majors of React in one repo ──────────────────────────────────────
 *
 * The web app is React 18.2; Expo SDK 57 requires React 19. npm hoists 18 to
 * the repo root and nests 19 under `apps/mobile`. If a transitive import ever
 * resolved React from the root while the app resolved it locally, the bundle
 * would carry two Reacts — which surfaces as "Invalid hook call" and sends you
 * reading your components instead of your resolver.
 *
 * ── Why the documented fix is wrong here ────────────────────────────────────
 *
 * Expo's monorepo guide answers (2) with `disableHierarchicalLookup = true`,
 * restricting resolution to `nodeModulesPaths` and nothing else. That assumes
 * a **flat, fully hoisted** layout, which is what Yarn gives you.
 *
 * npm's layout here is not flat, and it is not flat *because of* the React
 * split: with two majors in play npm nested `expo-modules-core` inside
 * `expo/node_modules`. Hierarchical lookup is the only thing that finds it, so
 * disabling it fails the bundle outright — verified, not predicted.
 *
 * So: leave hierarchical lookup on, and close the duplicate-React hazard
 * directly by pinning the three packages that must never be duplicated. That
 * is narrower than the blanket rule and it targets the actual risk, rather
 * than banning a resolution strategy this install depends on.
 */

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the whole workspace so edits to packages/core reach the bundler.
config.watchFolders = [workspaceRoot];

// Prefer this app's own node_modules, then the workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

/*
  Exactly one copy of each of these, whoever asks and from wherever.

  React and react-native break loudly when duplicated. `@crewchief/core` is
  here for a different reason: it is the shared package, and two copies of it
  resolving differently on web and mobile would be the silent version of the
  same bug — the drift the monorepo was chosen to prevent.
*/
config.resolver.extraNodeModules = {
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
  '@crewchief/core': path.resolve(workspaceRoot, 'packages/core'),
};

/*
  ── The tsconfig alias that was never meant to reach the bundler ─────────────

  `tsconfig.json` maps `react` to `./node_modules/@types/react` to settle the
  *type-level* half of the React 18/19 split described above — react-navigation
  resolving the hoisted React 18 types while this app resolves 19.

  **Expo's Metro reads tsconfig `paths` too**, and honours them ahead of
  `extraNodeModules`. So that alias silently became a runtime instruction, and
  the bundle failed on the first launch of the first build:

      While trying to resolve module `react` … the package
      `apps/mobile/node_modules/@types/react/package.json` was successfully
      found. However, this package itself specifies a `main` module field that
      could not be resolved.

  Correct, and exactly what was asked for: `@types/react` is declarations, so
  there is nothing to execute. A type-checker alias had been handed to a
  bundler. It typechecked clean and could not run — the same shape as the
  eas.json that validated locally and was rejected on first use.

  ── Why `experiments.tsconfigPaths: false` is not the fix ────────────────────

  Because the *other* alias in that file is load-bearing at runtime.
  `packages/core` declares `main: src/index.ts` and no `exports` map, so
  `@crewchief/core/health-band` resolves through `@crewchief/core/*` →
  `../../packages/core/src/*` — a tsconfig path. Turning tsconfig paths off
  fixes React and breaks every shared-module import in the app.

  So the two aliases are separated by what they are for, here, rather than by
  switching off the mechanism they share.
*/
const PINNED_TO_THIS_APP = new Set(['react', 'react-dom', 'react-native']);

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // `react`, and also `react/jsx-runtime`, `react-native/Libraries/...`.
  const packageName = moduleName.startsWith('@')
    ? moduleName.split('/').slice(0, 2).join('/')
    : moduleName.split('/')[0];

  if (PINNED_TO_THIS_APP.has(packageName)) {
    try {
      return {
        type: 'sourceFile',
        filePath: require.resolve(moduleName, { paths: [projectRoot] }),
      };
    } catch {
      // Fall through rather than fail: a subpath this app does not have is a
      // resolution question, and Metro's own resolver gives a better error for
      // it than a rethrow from here would.
    }
  }

  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
