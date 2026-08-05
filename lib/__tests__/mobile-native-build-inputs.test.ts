/**
 * What has to be true *before* a cloud build is spent.
 *
 * @jest-environment node
 *
 * The Expo client is compiled on EAS because this Mac cannot build it, and the
 * free plan allows **15 iOS builds a month**. Ordinary JavaScript changes cost
 * none — the development build loads them from Metro. A **native module** costs
 * one, because native code has to be compiled in before it can run at all.
 *
 * That makes two mistakes expensive in a way nothing else in this repo is:
 *
 *   1. **Adding native modules one at a time.** Two modules added in two
 *      commits are two builds. Camera (Phase 4) and push notifications
 *      (Phase 5) were deliberately installed together on 5 Aug for this reason.
 *   2. **Shipping a native module without its iOS usage description.** iOS
 *      terminates the app the moment a permission is requested without one, and
 *      App Store review rejects the binary. Neither is visible until the build
 *      exists — so the check would otherwise arrive one build too late.
 *
 * The second is the one this file mostly exists for. It is the same shape as
 * the `eas.json` defect recorded in `apps/mobile/EAS_CONFIG_NOTES.md`: a config
 * committed without ever being executed, whose error surfaced on first use.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MOBILE = join(__dirname, '..', '..', 'apps', 'mobile');

const appJson = JSON.parse(readFileSync(join(MOBILE, 'app.json'), 'utf8')).expo;
const packageJson = JSON.parse(readFileSync(join(MOBILE, 'package.json'), 'utf8'));

/**
 * Native modules present in the build, and the iOS usage description each one
 * makes mandatory.
 *
 * **Adding an entry here means the next build must be spent before that module
 * works.** Batch it with anything else pending rather than building twice.
 */
const NATIVE_MODULES: Record<string, { infoPlistKeys: string[]; phase: string }> = {
  'expo-image-picker': {
    // Both, because the picker can reach the camera or the library and iOS
    // requires a description for whichever is touched first.
    infoPlistKeys: ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription'],
    phase: 'Phase 3.3 / 4 — photograph an invoice',
  },
  'expo-notifications': {
    // Remote push needs no Info.plist string; the entitlement is provisioning,
    // which EAS manages. Listed with none rather than omitted, so the module is
    // still covered by the batching assertion below.
    infoPlistKeys: [],
    phase: 'Phase 5 — recall and service-due alerts',
  },
};

describe('native modules are declared', () => {
  it.each(Object.keys(NATIVE_MODULES))('%s is a dependency', (module) => {
    expect(packageJson.dependencies).toHaveProperty(module);
  });

  it('installs every pending native module in one build, not several', () => {
    /*
      The batching rule, made checkable. Each of these costs a build if it
      arrives alone; together they cost one. If a module is added here in a
      later commit while the others are already compiled in, that commit is
      spending a second build — which may be the right call, but it should be a
      decision rather than a surprise.
    */
    const declared = Object.keys(NATIVE_MODULES);
    const installed = declared.filter((m) => packageJson.dependencies?.[m]);

    expect(installed).toEqual(declared);
  });
});

describe('iOS usage descriptions exist before the build is spent', () => {
  const infoPlist = appJson.ios?.infoPlist ?? {};

  const required = Object.entries(NATIVE_MODULES).flatMap(([module, { infoPlistKeys }]) =>
    infoPlistKeys.map((key) => [module, key] as const)
  );

  it.each(required)('%s requires %s', (_module, key) => {
    /*
      Set on `ios.infoPlist` explicitly rather than left to the config plugin.
      The plugin does declare them, but `expo config --type prebuild` does not
      show them — the mod runs later — so they could not be verified without
      generating an `ios/` directory, and generating one would switch EAS from
      a managed build to a bare one. Declaring them here makes the value
      readable now, which is the whole point: a permission string that cannot
      be checked until the build exists is checked one build too late.
    */
    expect(typeof infoPlist[key]).toBe('string');
    expect((infoPlist[key] as string).length).toBeGreaterThan(20);
  });

  it('explains what the app does with the permission, not that it wants one', () => {
    // App Store review rejects strings that restate the permission ("needs
    // camera access"). Each has to name the thing the person gets.
    for (const [, key] of required) {
      const text = infoPlist[key] as string;
      expect(text).toMatch(/invoice/i);
      expect(text.toLowerCase()).not.toMatch(/^crewchief (needs|requires) (the )?(camera|photo)/);
    }
  });
});

describe('the build profile still targets the simulator', () => {
  it('keeps developmentClient, which is what makes 15 builds a month enough', () => {
    const eas = JSON.parse(readFileSync(join(MOBILE, 'eas.json'), 'utf8'));

    /*
      Without this the JavaScript is baked into the binary and every code
      change costs a build — the month would be gone in two days, which is the
      measurement `EAS_CONFIG_NOTES.md` records.
    */
    expect(eas.build.simulator.developmentClient).toBe(true);
    expect(eas.build.simulator.ios.simulator).toBe(true);
  });
});
