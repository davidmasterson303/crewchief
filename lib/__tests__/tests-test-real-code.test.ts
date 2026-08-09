/**
 * Every suite must exercise shipped code, not a copy of it.
 *
 * @jest-environment node
 *
 * This repo's signature failure, three times over:
 *
 *   - `security.test.ts` defined its own `runMiddlewareLogic()` and tested
 *     that, while the exported middleware was a no-op with an empty matcher.
 *     11 green tests asserting protection the app did not have.
 *   - `rls-ownership.test.ts` tests a `mockVehicleDb` and `simulate*` helpers
 *     defined in its own file. It was titled "RLS Ownership Verification"
 *     while the `vehicles` table's real policies were `USING (true)`.
 *   - `tco-calculator.test.ts` defined its own `calculateTCO` and
 *     `estimateResaleValue` while the shipped math lived in a component. The
 *     two copies drifted into different depreciation models and the suite
 *     stayed green for months.
 *
 * Each was found by hand, long after the fact. The rule that would have caught
 * all three is one line: **a test that imports nothing is testing itself.**
 *
 * Phase 2.4 asked for a sweep for a third instance. This is that sweep, made
 * permanent — moving files between packages is exactly when a test quietly
 * stops pointing at the thing it names, so the guard matters more during the
 * shared-package work than it did before it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TESTS_DIR = __dirname;

/**
 * Suites that legitimately import no application module because they *are*
 * static analysis — they read source files off disk and assert about their
 * contents. Each is verified below to actually do that, so an entry cannot be
 * used as a blanket excuse.
 */
const STATIC_ANALYSIS_SUITES = [
  // Reads globals.css and tailwind.config.ts to prove the sport register
  // overrides only tokens something actually reads. There is nothing to
  // import: the subject is a block of CSS custom properties, and the failure
  // it pins is SILENT — overriding a token nothing reads changes nothing and
  // looks exactly like working code. jsdom resolves neither `var()` through
  // Tailwind's generated utilities nor `clip-path`, so the rendered check the
  // guard would otherwise want is not available under any runner here.
  'register-tokens.test.ts',
  'auth-posture.test.ts',
  'internal-fetch-posture.test.ts',
  // Reads apps/mobile off disk to prove the Expo client never queries Supabase
  // directly. It cannot import what it checks: those modules are React Native,
  // and loading one under this runner would fail on the transform rather than
  // on the rule. Absence of `.from(` in the source is the whole signal.
  'mobile-api-only.test.ts',
  // Reads the two vehicle routes' column constants to prove the detail
  // endpoint is a superset of the list endpoint. Executing either needs a live
  // Supabase, and the property is which columns are *asked for* — a string
  // constant in each file.
  'vehicle-detail-not-poorer.test.ts',
  // Reads apps/mobile's app.json, package.json and eas.json to prove a cloud
  // build will not be wasted: native modules batched, and every iOS usage
  // description present. There is nothing to import — the subject is three
  // config files, and the failure they pin is only observable after a build has
  // already been spent.
  'mobile-native-build-inputs.test.ts',
  // Reads dev-session.ts to prove every EXPO_PUBLIC read sits inside a __DEV__
  // branch. EXPO_PUBLIC values are inlined at transform time, so an unguarded
  // read compiles a real password into the release binary — a property of the
  // source, and one no runtime assertion could observe.
  'mobile-dev-session-stripped.test.ts',
  // Reads app/actions.ts to prove the health summary queries the table an
  // invoice actually writes, and that the refresh sits in the shared upload
  // path rather than in one client component. Executing either half needs a
  // live Supabase and a Gemini call; what regressed is which tables are read
  // and where the trigger lives, both of which are on disk.
  'health-sees-filed-invoices.test.ts',
  // Reads apps/mobile off disk for text colours below the AA floor. The web
  // guard `text-contrast-floor.test.ts` scans app/ and components/ for Tailwind
  // class names and structurally cannot see an rgba() in a React Native
  // StyleSheet, which is how the Expo client stayed outside the rule from Phase
  // 3.1 until 5 Aug. The colour literal in the source is the whole signal.
  'mobile-text-contrast.test.ts',
  // Reads SignInScreen and core-check.ts off disk to prove the on-device core
  // probe is still rendered by something. It spent Phase 3.2 onward imported by
  // nothing; the subject is React Native source this runner cannot load, and
  // "is it wired in" is structural.
  'mobile-core-check-wired.test.ts',
  // Reads GarageScreen off disk to prove account deletion is reachable in
  // every state it can render — App Store 5.1.1(v). Same constraint as
  // `mobile-api-only`: the subject is a React Native component this runner
  // cannot load, and the property is structural (does each return path carry
  // the affordance) rather than behavioural.
  'mobile-account-reachable.test.ts',
  // Reads apps/mobile's screens for a Pressable that swaps its <Text> for an
  // ActivityIndicator without naming itself — the control loses its accessible
  // name at exactly the moment it is working. Same constraint as the scans
  // above: React Native source this runner cannot load, and the property is
  // structural rather than something a render test could reach on every screen.
  'mobile-busy-controls-named.test.ts',
  // Reads the upload route to prove it authorizes where the HTTP status is
  // still available, rather than letting a denial fall through the error
  // mapping as a 500. Executing it would need a live Supabase, a storage
  // bucket and a vision model; the property that regressed is which function
  // is called and in what order, which is on disk.
  'upload-route-status-codes.test.ts',
  'vehicles-rls-posture.test.ts',
  // Replays the migration corpus to find blanket RLS policies a rebuild would
  // declare. There is nothing to import: the subject is the SQL on disk, and
  // the live database is a different question this deliberately does not ask.
  'rls-blanket-policies.test.ts',
  // Reads the maintenance page and app/actions.ts to prove no provenance claim
  // is rendered that nothing on the row substantiates. The badge it pins had
  // no condition anywhere near it, so absence in the source is the signal;
  // rendering the page would test the claim's styling, not its truth.
  'provenance-claims.test.ts',
  // Reads every .tsx off disk for hover-only reveals written as raw Tailwind.
  // The subject is a class name in the markup and a media query in
  // globals.css — rendering a component would prove its opacity under jsdom,
  // which implements neither `(hover: none)` nor the cascade that decides it.
  // Absence of an unpaired `group-hover:opacity-100` is the whole signal.
  'touch-parity.test.ts',
  // Reads every .tsx off disk for body text below the AA contrast floor item 17
  // set. The subject is a Tailwind alpha in a class string; rendering the
  // component would prove what jsdom computes, which is not what a browser
  // composites over a backdrop — and item 17's own rendered probe is what
  // missed the front door, because it only sees routes someone remembered to
  // visit. The class name in the source is the whole signal.
  'text-contrast-floor.test.ts',
  // Reads every .tsx off disk for a 3+ column grid with no breakpoint — R3's
  // shape, where 231px split three ways left the text cell at roughly zero and
  // "8-speed automatic" wrapped one character per line. jsdom has no layout, so
  // no rendered assertion in this repo can observe a column's resolved width;
  // the class string is deterministic and is the whole signal.
  'responsive-grid-floor.test.ts',
  'portability.test.ts',
  'ws-optional-deps.test.ts',
  'illustration-tokens.test.ts',
  'env-parity.test.ts',
  'tests-test-real-code.test.ts',
  // Reads components/ to prove that anything mutating a vehicle also
  // invalidates the garage query key. The bug it pins is invisible at runtime
  // in a unit test — the garage is a TanStack cache in a browser, and all
  // three instances found on 30 Jul were a mutation that simply never
  // mentioned the cache. Absence in the source is the only signal.
  'garage-cache-invalidation.test.ts',
  // Reads @google/genai's own dist entries to prove the protobufjs CRITICAL is
  // never loaded. Importing the tokenizer to test it would load the very module
  // the suite exists to show is unreachable.
  'protobufjs-unreachable.test.ts',
  // Reads app/actions.ts to prove a parameter is actually referenced. An unused
  // parameter raises no type error, so only a source scan catches it returning.
  'performance-goal.test.ts',
  // Reads app/actions.ts against two migration files, because the failures it
  // pins are agreements between code and schema that no runtime in this repo
  // checks: an upsert conflict target naming a constraint that does not exist,
  // a status outside its CHECK, a NOT NULL column omitted. Every one was
  // rejected by Postgres and had its error discarded, so the only place the
  // disagreement is visible is the source of both sides.
  'mod-details-goal-key.test.ts',
  // Reads globals.css and the two curtain components to prove the garage-door
  // intro is still drawn rather than photographed. The thing it guards against
  // — swapping the CSS slats for a 1.4 MB JPEG — renders correctly, so no
  // runtime assertion can see it. Only the source can.
  'garage-door-cost.test.ts',
  // Reads components/, hooks/ and app/ to prove every requestAnimationFrame
  // loop and every smooth scroll asks about prefers-reduced-motion. There is
  // nothing to import: the subject is the *absence* of a check across the
  // whole tree, and the two gaps it was written after — TCOCard's rAF ring and
  // ConsultantChat's smooth scroll — both animate correctly and would pass any
  // behavioural assertion. jsdom also reports no media-query match, so a
  // rendered test cannot tell a component that asked from one that did not.
  'reduced-motion.test.ts',
  // Walks every route.ts under app/api/v1 to prove none authenticates through
  // the cookie-only client. There is nothing to import: the subject is the
  // *absence* of a call across seventeen files, and importing a route would
  // execute Next's module graph rather than answer the question. The property
  // is also invisible at runtime in the only environment tests run in — a
  // cookie-authenticated handler behaves perfectly until a client with no
  // cookies calls it, which is the mobile app and not this runner.
  'v1-accepts-bearer.test.ts',
  // Reads the vehicles route to prove `POST` authorizes with `requireCaller`
  // rather than the cookie-only client, never takes `user_id` from the body,
  // and does not block on the ~23s dossier research. Executing it needs a live
  // Supabase and a session; the properties that matter are which helper is
  // called and what is refused, both of which are on disk. Same reasoning as
  // `upload-route-status-codes`.
  'create-vehicle-route.test.ts',
  // Reads the A2a migration against the modules that name its column and its
  // source value. Same class as `mod-details-goal-key`: an agreement between
  // SQL and TypeScript that no runtime here checks, because Postgres rejects
  // the write and the error is swallowed. `LogServiceModal` has been inserting
  // a non-existent column with an illegal source for months without a symptom.
  'service-baseline-schema.test.ts',
  // Reads the sweep route and its Netlify scheduler. The route sends a push to
  // every account in the product, so its authorization is the most abusable
  // thing here if it is ever wrong — and executing it needs a live Supabase, a
  // service-role key and a push endpoint. What matters is which checks exist
  // and in what order, which is on disk.
  'notify-sweep-route.test.ts',
  // Reads DashboardLayout's tab block to prove the section nav uses Link with
  // prefetch, so a switch transfers one segment instead of re-booting 26 JS
  // chunks. jsdom has no router, segment cache or prefetch, so none of it is
  // observable in a rendered test; the evidence is a browser measurement
  // recorded in that file's docblock, and this is the ratchet.
  'dashboard-tabs-prefetch.test.ts',
  // Reads the button primitive's cva string. jsdom computes no layout, so it
  // cannot tell 40px from 44px, and it does not composite a var() against a
  // backdrop — the rendered evidence is a browser measurement recorded in that
  // component's docblock. What regresses is which classes are declared.
  'button-primitive.test.ts',
];

/**
 * Suites that deliberately model behaviour rather than exercise it.
 *
 * **This list may only shrink.** An entry here is an admission that the suite
 * proves nothing about shipped code, and it must say so in its own header so a
 * reader is not misled by the filename.
 */
const DECLARED_SIMULATIONS = ['rls-ownership.test.ts'];

/*
  App code is `@/…`, a relative path, or the shared workspace package.

  The `@crewchief/` arm was added when Phase 2.4 moved the first module into
  packages/core — and this suite failed the moment it did, which is the
  behaviour to keep. A suite whose subject moves out from under it should stop
  the build, not quietly start passing for the wrong reason.
*/
const IMPORTS_APP_CODE =
  /(?:from\s+|require\()\s*['"](?:@crewchief\/|@\/|\.\.?\/)(?!.*__tests__)/;

/*
  `.tsx` as well as `.ts`.

  Globbing only `.test.ts` was a silent hole in exactly the guard whose job is
  to catch tests that do not test anything: every component suite escaped it,
  and the way to evade the check was to name a file `.tsx`. Found when the
  illustration grid suite — a `.tsx` — was not picked up at all. Both existing
  `.tsx` suites already imported real modules, so closing it cost nothing;
  leaving it open would have cost the next one.
*/
function suites(): string[] {
  return readdirSync(TESTS_DIR).filter((f) => /\.test\.tsx?$/.test(f));
}

describe('every suite exercises shipped code', () => {
  const all = suites();

  it('found suites to check', () => {
    expect(all.length).toBeGreaterThan(15);
  });

  it.each(
    suites().filter(
      (f) => !STATIC_ANALYSIS_SUITES.includes(f) && !DECLARED_SIMULATIONS.includes(f)
    )
  )('%s imports a real module', (file) => {
    const source = readFileSync(join(TESTS_DIR, file), 'utf8');
    expect(source).toMatch(IMPORTS_APP_CODE);
  });

  it.each(STATIC_ANALYSIS_SUITES)('%s really is static analysis', (file) => {
    // An exemption that stopped being true is how an allowlist rots. If one of
    // these stops reading source off disk, it is an ordinary suite again and
    // should be importing what it tests.
    const source = readFileSync(join(TESTS_DIR, file), 'utf8');
    expect(source).toMatch(/readFileSync|readdirSync/);
  });

  it.each(DECLARED_SIMULATIONS)('%s admits in its header that it is a model', (file) => {
    // The failure mode is not the simulation, it is a simulation whose name
    // and docblock claim it verifies the real thing.
    const source = readFileSync(join(TESTS_DIR, file), 'utf8');
    const header = source.slice(0, source.indexOf('*/'));
    expect(header).toMatch(/does not test|simulation|model/i);
  });

  it('keeps the simulation list from growing', () => {
    // Deliberately pinned rather than compared to a count, so adding an entry
    // is a decision someone has to write down here.
    expect(DECLARED_SIMULATIONS).toEqual(['rls-ownership.test.ts']);
  });
});
