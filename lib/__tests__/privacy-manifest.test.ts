/**
 * The privacy manifest has to keep describing the app that ships.
 *
 * @jest-environment node
 *
 * Phase 6, E4. Apple cross-checks `NSPrivacyCollectedDataTypes` against the App
 * Store Connect answers, and a mismatch between them is a rejection that
 * arrives *after* a build has been spent — which on this project means one of
 * fifteen monthly cloud builds.
 *
 * ── Why a declaration needs a guard at all ──────────────────────────────────
 *
 * A privacy manifest is a **claim about behaviour written in configuration**,
 * which is the shape this repo keeps getting wrong: nothing executes it, no
 * typechecker reads it, and it stays green while the code beneath it moves. The
 * specific decay is one direction — a feature adds a data type and nobody
 * remembers the manifest — so the assertions below are anchored to code and
 * schema, not to the manifest's own contents.
 *
 * ── What this cannot do ─────────────────────────────────────────────────────
 *
 * It cannot prove the list is *complete*. Proving that would mean deriving
 * Apple's taxonomy from the source, which is a judgement call per column —
 * whether a user-typed ZIP is Coarse Location, whether a VIN is an identifier.
 * Those calls are recorded in `APP_STORE_PRIVACY_ANSWERS_2026-08-12.md` with
 * their reasoning. What this pins is the handful that are unambiguous and the
 * two that would be actively false.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

const appJson = JSON.parse(readFileSync(join(ROOT, 'apps/mobile/app.json'), 'utf8'));
const manifest = appJson.expo?.ios?.privacyManifests;

/** The declared data types, without the long Apple prefix. */
const declared: string[] = (manifest?.NSPrivacyCollectedDataTypes ?? []).map((entry: any) =>
  String(entry.NSPrivacyCollectedDataType).replace('NSPrivacyCollectedDataType', '')
);

function source(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('the iOS privacy manifest', () => {
  it('exists at all', () => {
    // Expo emits PrivacyInfo.xcprivacy from this block. Without it the app
    // ships no app-level manifest, and only its dependencies' ones.
    expect(manifest).toBeDefined();
    expect(declared.length).toBeGreaterThan(0);
  });

  it('declares no tracking, and no tracking domains', () => {
    /*
      Both must be true together. `NSPrivacyTracking: false` alongside a
      non-empty `NSPrivacyTrackingDomains` is a contradiction Apple rejects on,
      and it is the shape that appears when an analytics SDK is added later and
      only half the manifest is updated.
    */
    expect(manifest.NSPrivacyTracking).toBe(false);
    expect(manifest.NSPrivacyTrackingDomains).toEqual([]);
  });

  it('has no tracking or analytics SDK that would contradict that', () => {
    /*
      The claim above is only as good as the dependency list under it. This is
      what makes `NSPrivacyTracking: false` an assertion rather than an
      aspiration — the history records that this app has no analytics product at
      all, only a structured logger, and that is load-bearing for the label.
    */
    const deps = JSON.stringify([
      JSON.parse(source('apps/mobile/package.json')).dependencies ?? {},
      JSON.parse(source('package.json')).dependencies ?? {},
    ]);

    for (const sdk of [
      'posthog',
      'plausible',
      'mixpanel',
      'amplitude',
      'segment',
      'sentry',
      'bugsnag',
      'appsflyer',
      'react-native-idfa',
      'expo-tracking-transparency',
    ]) {
      expect(deps).not.toContain(sdk);
    }
  });

  it('declares photos, because the app asks for the photo library and the camera', () => {
    // Anchored to the permission strings rather than to the manifest: if those
    // usage descriptions exist, the data type must be declared.
    const ios = appJson.expo.ios.infoPlist;
    expect(ios.NSPhotoLibraryUsageDescription).toBeTruthy();
    expect(ios.NSCameraUsageDescription).toBeTruthy();
    expect(declared).toContain('PhotosorVideos');
  });

  it('declares a device id, because one is minted and sent to the server', () => {
    /*
      `apps/mobile/src/notifications/register.ts` mints a per-install UUID,
      keeps it in the Keychain and files it against the account in
      `device_push_tokens`. It is not a hardware identifier and it dies with
      the app — but it leaves the device attached to a user id, which is what
      the declaration is about.
    */
    expect(source('apps/mobile/src/notifications/register.ts')).toContain('deviceId');
    expect(declared).toContain('DeviceID');
  });

  it('declares coarse location while a ZIP code is still collected', () => {
    /*
      The one the roadmap got wrong. E4 was described as "genuinely short by
      design: no hardware inventory, no notification history, no location" —
      but `savePreferredZipCode` writes `vehicles.preferred_zip_code`, and the
      quote-request dialog reads it.

      If the ZIP is ever removed, this test fails and the declaration should
      come out with it — an over-declared label is not free, it is a promise
      about behaviour that invites a question nobody can answer.
    */
    const collectsZip = source('app/actions.ts').includes('preferred_zip_code');
    expect(collectsZip).toBe(true);
    expect(declared).toContain('CoarseLocation');
  });

  it('declares user content, because conversations and invoices are stored', () => {
    expect(declared).toContain('OtherUserContent');
  });

  it('declares an email address, because accounts are email and password', () => {
    expect(declared).toContain('EmailAddress');
  });

  it('marks every declared type as linked to the user', () => {
    /*
      True by construction here and worth pinning: every table in this schema
      that holds user data carries `user_id`, or reaches it through
      `vehicle_id`. There is no anonymous bucket in the *app* — the anonymous
      front door is a web surface and does not ship in the binary.
    */
    for (const entry of manifest.NSPrivacyCollectedDataTypes) {
      expect(entry.NSPrivacyCollectedDataTypeLinked).toBe(true);
      expect(entry.NSPrivacyCollectedDataTypeTracking).toBe(false);
    }
  });

  it('does not yet claim purchase history, because nothing sells anything', () => {
    /*
      E8 has not been built. Declaring purchases before there is a purchase
      flow is the mirror of forgetting to declare one afterwards, and it is the
      easier mistake to make while writing this file in advance.

      **When Apple IAP lands, add `PurchaseHistory` and delete this test.** It
      is written to fail the moment a purchase path appears.
    */
    const hasIAP = /react-native-iap|expo-in-app-purchases|revenuecat|StoreKit/i.test(
      JSON.stringify(JSON.parse(source('apps/mobile/package.json')).dependencies ?? {})
    );

    expect(hasIAP).toBe(false);
    expect(declared).not.toContain('PurchaseHistory');
  });
});
