# CrewChief roadmap — image pipeline, backdrop, cockpit direction, and responsive web

> ### ⚠ 22 Aug — START HERE. Four commits shipped; two migrations and one Apple link are waiting.
>
> **The device build is still the priority and still blocked on the same three minutes.**
> Re-verified twice on 22 Aug, with the Expo token from `.env` so the CLI authenticates:
>
> ```
> $ eas device:list
> No Apple teams found for account masterson303.
> ```
>
> `EXPO_TOKEN` in `.env` works and authenticates as `masterson303` — so **everything after
> the Apple link is Claude Code's**, including `device:create` and the build. Only step 1
> needs David:
>
> ```
> cd apps/mobile && npx eas-cli credentials
> ```
>
> ---
>
> #### ✅ Verified in production today — both 21 Aug fixes work
>
> David added a 2003 Accord (`91c9eaae`) through the real user path at 12:31:26. Sixty
> seconds later: `research_status = completed`, a dossier with 7 known issues and a 9-item
> maintenance schedule, and **24 NHTSA recalls** including the Takata inflator campaigns.
>
> `7a662f3` works. The recall tile correctly refused to claim an all-clear on an unresearched
> car. **The board's "deployed and UNVERIFIED" line is closed.**
>
> ⚠ **A report that research "still fails" was wrong at the data layer, and the distinction
> is the useful part.** The work completes; the *browser* is told it failed. The request
> outlives its response, `enrichVehicle` returns no body, and the client reads `.success` off
> `undefined` — `RESEARCH_STATUS:THREW`. One invocation ran 12:31:26 → 12:32:26 with writes at
> +30s and +60s, so the function was not killed at 10s or 26s; the gateway gave up on the
> response while the function ran on. **Netlify's function log for that minute is the one
> piece of evidence not available from here** — the CLI is not logged in on this machine.
>
> So the fix is not to make research faster or split the dossier into stages. It is to stop
> the browser awaiting a call that already works: the component already receives `status`, and
> `research_status` reaches `completed` on its own. **Poll it.** That is the next research
> task and it is small.
>
> #### 💰 The dossier is measured, for the first time
>
> ```
> gemini-2.5-pro    1,054 in · 1,802 out · 2,045 thinking · 4,901 total · one attempt
> ```
>
> **≈ $0.03–0.04 per vehicle** ($1.25/$10 per M for 2.5 Pro; ≈$0.030 at the flat $1.50/$7.50
> the older figures use). Against `modification_details` at $0.0087 a call, a dossier is the
> most expensive single call in the product — about 1.5% of the entire three-week bill, spent
> once per vehicle added. `lib/vehicle-research.ts:140` says D6 is decided on this number; it
> now has it.
>
> ⚠ **Thinking is 2,045 of 3,847 billed output tokens — 53% of what the call costs.**
> `proStructuredConfig` sets temperature, topK, topP and `maxOutputTokens` and **no thinking
> level**. It is the largest unexamined lever left in the bill. Unlike the mod paths this is a
> research-and-judgment call, so the 21 Aug precedent (consultant and health summary stay at
> `LOW`) may well apply — but it is now measurable the same way, and the invoice-extraction
> note in `app/actions.ts` describes the corpus method for settling exactly this.
>
> ⚠ **Usage is recorded per attempt, before the parse** (`vehicle-research.ts:137`). A flow
> that fails downstream still bills, and the retry loop bills up to three times. "No dossier
> completed" and "a dossier was billed" are both true statements about the same run.
>
> #### What shipped 22 Aug
>
> | | |
> |---|---|
> | `c0ebf9e` | **the prose asserted the all-clear the tile had just refused** — see below |
> | `bc24206` | a dossier that already exists is never paid for twice |
> | `a0561b6` | research on activity, notify on devices — and one car is one push |
> | `9c34b7d` | a VIN somebody else owns sent you to their car, then to nowhere |
>
> **⚠ The safety fix is the one to understand.** On the same screen where the tile said "We
> have not checked this vehicle for recalls yet… This is not a clear result", the generated
> narrative said **"While there are no active recalls, key high-mileage services must be
> evaluated."** The 21 Aug fix landed on the component; the generator kept its own copy of the
> question (`nhtsa?.recalls?.length || 0`), and a model handed "Active Recalls: 0" writes
> "there are no active recalls", correctly. **Prose is the more dangerous half** — it is what
> a person reads, and it carries no icon to qualify it.
>
> The same function's parse-failure defaults were `'Vehicle is in good condition'`,
> `'Maintenance records up to date'` and `'No recalls to date'` — a clean bill of health on
> every axis, applied exactly when least is known. Both are fixed; the rule lives in
> `health-claims.ts` beside the tile's rule so the halves cannot drift again.
>
> **The generation gate was filtering on the wrong thing.** `vehiclesToGenerate` required
> `hasPushToken`, which is sound about notifications and wrong about dossiers — a dossier
> feeds the dashboard, the health report and the consultant's context, none of which involve
> a phone. The reviewer's account has no device, so its Accord was unreachable by design.
> Now: **research on `last_sign_in_at` within 90 days, notify on device tokens.**
>
> #### ⛔ Two migrations written and NOT applied — one SQL trip
>
> ```
> supabase/migrations/20260821140000_the_same_car_should_not_be_researched_twice.sql
> supabase/migrations/20260822120000_a_sweep_that_did_not_run_looks_like_a_quiet_night.sql
> ```
>
> Both additive-only, one new table each, no drops and no grants touched — the "Potential
> issue detected" modal should not fire on either. Until they land: the mod-detail cache is
> inert (full price, nothing broken — the code falls through to generating), and the sweep
> still has no durable record that it ran.
>
> #### ⚠ 24 push notifications are queued for the next real sweep
>
> A dry run against production, 22 Aug, before the fix:
>
> ```
> scanned 3 · recallsPlanned 24 · servicesPlanned 1
> ```
>
> The Accord's 24 un-raised campaigns were 24 separate pushes, to one phone, in one evening.
> `SWEEP_SEND_CAP` is 200 for the whole run and there was no per-vehicle limit.
> `recallsToRaise` already refuses this shape in the other direction — one recall repeating
> nightly "ends with notifications disabled and every future recall unheard" — and 24 at once
> ends the same way. It only happens on the first sweep after a car's recalls are fetched,
> which means it lands on new users.
>
> `digestRecalls` fixes it: **one car is one notification**, headed by the count, with every
> campaign still deduped. After:
>
> ```
> scanned 3 · recallsPlanned 1 · recallCampaignsRaised 24 · generationPlanned 1
> ```
>
> ⚠ **The fix is on `main`, and nothing deploys from `main`.** Until someone promotes, the
> nightly sweep runs the old code from `web-live`. Whether it fires at all is unknown — see
> the heartbeat, which exists precisely because that question has no answer today.
>
> #### State
>
> ```
> main                 9c34b7d + this commit, clean
> unpromoted           8 to web-live, 10 to demo-live  (counting this one)
> web tests            150 suites / 2735 passing
> mobile tests          23 suites /  329 passing
> migrations pending   20260821140000, 20260822120000
> ```
>
> #### Next, in order
>
> | # | What | Who |
> |---|---|---|
> | **1** | `npx eas-cli credentials` — the Apple link | **David · 3 min** |
> | **2** | Apply the two migrations | **David / Cowork · one trip** |
> | **3** | Poll `research_status` instead of awaiting `enrichVehicle` | Claude Code |
> | **4** | Register the UDID, one EAS build, device QA | Claude Code |
> | **5** | Measure a thinking level on the dossier against a corpus | Claude Code |
>
> ⚠ **The `DemoBanner` and CTA decisions below are still David's, and `20260818120000` is
> done** — the ⛔ on it in the 19 Aug block was stale for three days and is now struck through.


> ### 21 Aug — the device build is three minutes of David's time away. **Superseded by the 22 Aug block above; the blocker is unchanged and its research and cost sections are now out of date.**
>
> **David's stated priority is getting CrewChief onto his own iPhone.** Everything needed for
> that is built and committed. It is blocked on exactly one thing, and it is not code.
>
> ---
>
> #### ⛔ The only blocker: Expo is not linked to the Apple Developer account
>
> ```
> $ eas device:list
> No Apple teams found for account masterson303.
> ```
>
> Re-verified 21 Aug. The membership is **active** (confirmed by David 19 Aug), but the Expo
> account has never been connected to the Apple team — so there are no signing certificates, and
> registering the phone is not even reachable yet.
>
> ⚠ **This is not the UDID step.** An earlier note said the blocker was device registration; that
> was wrong and cost a day. Registration comes *after* the link.
>
> | | | |
> |---|---|---|
> | **1** | `cd apps/mobile && npx eas-cli credentials` — sign in with Apple ID, complete 2FA | **David · ~3 min** |
> | **2** | `eas device:create` → register the iPhone's UDID (a link David opens on the phone) | Claude Code + David |
> | **3** | `eas build --platform ios --profile device` | Claude Code · ~15 min, 1 build |
>
> **Claude Code cannot do step 1** — it needs an Apple ID password and a live 2FA code, and
> handing an agent credentials is refused regardless of capability. Cowork cannot either: the
> prompt is on the Mac, so iPhone Mirroring does not help.
>
> #### What is already done for the device path
>
> - **`device` profile exists** in `apps/mobile/eas.json` (`d5cb8fe`) — `developmentClient: true`,
>   internal distribution, `simulator: false`.
> - ⚠ **`developmentClient` is the whole economics.** One build, then Metro serves the JS: every
>   screen, colour and string change is free. A standalone build costs one of ~12 monthly iOS
>   builds *per string change*. Only a new native module costs another.
> - **The path is proven.** A simulator build ran end to end 20 Aug (`924a303a`), installed via
>   `xcrun simctl`, connected to Metro, and reached the sign-in screen. Screenshots in that
>   session. **4 EAS builds used ever**, all simulator; the period resets 31 Aug.
>
> #### Restarting the simulator loop (free, works today, no Apple link needed)
>
> ```
> cd apps/mobile && npx expo start --dev-client
> ```
>
> The app is still installed on the iPhone 16 Pro simulator. ⚠ Metro is **down** — it was killed
> when the previous session ended, so nothing will reload until this is run.
>
> ⚠ **The live simulator panel does not work.** `mcp__Claude_Code_iOS_Simulator__attach` insists
> Xcode is not selected even though `xcode-select -p` already returns the path it asks for and
> `simctl` works fine. Its environment resolves differently. The command it wants is
> `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` (needs David's password).
> Until then: `xcrun simctl` for install/launch/screenshot, and **no tapping** — `osascript` is
> denied assistive access, so Claude Code can reach the sign-in screen and no further.
>
> ---
>
> #### What shipped 20–21 Aug
>
> | | |
> |---|---|
> | `dbc35cb` | each site's share card describes that site — the App Store hostname was serving the demo's `og:url`, `og:image` **and** description |
> | `ad0733b` | the demo masthead is gated behind `CREWCHIEF_DEMO_SITE`, unset meaning product |
> | `21c514e` | **an unrun check is not an all-clear** — see below |
> | `7a662f3` | **research never ran for a new vehicle** — see below |
> | `d5cb8fe` | the `device` build profile |
>
> **⚠ The safety fix is the one to understand first.** A 2003 Honda Accord — inside the Takata
> airbag campaigns — displayed a **green tick and "No active recalls"**, because its NHTSA record
> had never been fetched and the tile read an empty status as good news. Nothing errored. The
> check had simply never run, and *absence rendered as an all-clear on a safety claim*.
> `packages/core/src/health-claims.ts` now has three states, and `unknown` is never green and
> never a tick. `CLAUDE.md` §6 named this exactly: `null` is never `0`.
>
> **⚠ The research bug that caused it.** `enrichVehicle` fetched the vehicle row and then called
> `generateVehicleDossier(vehicleId)` — no second argument — three lines later. From 27 Jul
> (`8e9fafd`) to 21 Aug, **every vehicle added got an empty dossier, no NHTSA record, and a retry
> button that could never work**, because retry called the same broken function. The parameter is
> required now, so the defect is a build error rather than a 200 carrying `{ success: false }`.
>
> #### ⏳ The research fix is deployed and UNVERIFIED
>
> Live on `web-live` (`f3278984`), but nobody has loaded the page:
>
> ```
> reviewer last_sign_in_at   2026-08-21T11:53:15   (the sign-up moment; zero sessions since)
> research_status            pending
> nhtsa_data rows            0
> ```
>
> ⚠ **`last_sign_in_at` is the instrument that settles this, and it was learned the hard way.**
> An hour went into theorising about cached bundles and effects not firing, when one query showed
> nobody had signed in. **Before diagnosing why a page did not do something, check that anyone
> loaded it.** Readable via `GET {SUPABASE_URL}/auth/v1/admin/users` with `SUPABASE_SECRET_KEY`.
>
> Two ways to close it: David signs in and opens the vehicle, **or** Claude Code runs a one-off
> script calling `researchVehicleDossier` with the service role and the reviewer's `user_id`.
> ⚠ Do **not** call `enrichVehicle`/`generateVehicleDossier` outside a session — that means going
> around `authorizeVehicleAccess`, and `vehicle-research-callers.test.ts` keeps that list closed
> deliberately. The sweep is already an authorized caller of the core; use that path.
>
> #### Decisions waiting on David — nothing else is blocked on code
>
> | | |
> |---|---|
> | **Price** | ✅ **Settled 21 Aug: $3.99/mo · $29.99/yr + 7-day trial.** David's constraint is explicit and worth carrying: *"it's important I don't lose money on this."* The ceiling rider is **done** — `TIERS.paid` is now 1,000,000 (`cb88f87`). ⏳ Still to do in App Store Connect: create the products at that price, add the trial, and **apply for the Small Business Program** — 15% vs 30% is worth more than the price decision itself ($3.39 vs $2.79 a subscriber) |
> | **Positioning** | *"CrewChief is a product being taken to market through the App Store, not a working demo. The demo remains a sales asset on the product site and a portfolio asset on the recruiter site."* Say yes and propose it to the KB — `cc-marketing-0002` still records "a working demo, not a commercial product" and its own open question was answered by action, never recorded |
> | **The CTA** | Follows from the positioning. Cowork's proposal: primary "Add your vehicle" → signup, secondary "See a sample garage", heading "What a CrewChief garage looks like". Demo host keeps "Enter demo". Same gate as the masthead. ⚠ `LandingHero` is a client component and cannot read `CREWCHIEF_DEMO_SITE` — needs a server wrapper or a provider |
> | **LLC** | The genuinely open half of `cc-business-0001`. Personal-liability question, not paperwork. Reversible: Apple converts Individual → Organization without re-enrolment |
> | **App Store Connect** | ⚠ **Paid Applications agreement FIRST** — StoreKit reportedly returns an empty product list until it is active, and the forms can sit pending for days |
> | **Rotate the reviewer password** | It is in a transcript. The risk is the portfolio write-up, not the file |
>
> #### Real AI economics — measured, not modelled
>
> All 292 metered calls, 2–21 Aug, input **and** output at $1.50/$7.50 per M:
>
> ```
> you (75834ade)   235 calls   $2.06   →  $3.10/month at this rate
> modification_details   232 calls   $2.019   89.4% of all spend
> consultant              10 calls   $0.068    3.0%
> ```
>
> ⚠ **`modification_details` is 89% of real spend, not the consultant.** Any cost model that omits
> it — including the "heavy month ≈ $0.20" figure — is optimistic by roughly 15×. The consultant
> *is* rate limited (`consultant:${vehicleId}`, `ai` tier), so that worry is closed; but the tier
> is 10/60s, a burst limit rather than a budget. `TIERS.paid` is the real ceiling.
>
> ⚠ **The dossier call has never been measured** — no research purpose appears in the table at
> all, consistent with it never having completed. It is the biggest single call in the product and
> the only unmeasured one. **Measure it the first time research succeeds.**
>
> #### 💸 Cost control — shipped 21 Aug, and the bill is not where anyone assumed
>
> Three weeks of metering (`ai_usage_events`, 2–21 Aug): 292 calls, $2.26. Of that,
> **`modification_details` was 232 calls and $2.02 — 89%.** The consultant, which the cost
> conversation is always about, was 3%.
>
> `cb88f87` does three things:
>
> - **A content-keyed cache** (`mod_detail_cache`). That call had **no cache at any level** while
>   being the most cacheable one in the product — its prompt reads six values and none identifies
>   a person or a car. Keyed on the *question*, not on `vehicle_id`, so the first owner of a 2018
>   Accord to open a mod pays and everyone after them does not. ⚠ `performance_mod_cache` does not
>   already do this: it caches the mod *list* and keys on the vehicle.
> - **`MINIMAL` thinking on the three mod paths.** Measured, same prompt and model:
>   `LOW 268 in · 432 out · 544 thinking · $0.00772` versus
>   `MINIMAL 268 in · 433 out · 0 thinking · $0.00365` — same horsepower figures, costs, brands
>   and warnings, at 53% the cost and 46% the latency. ⚠ **The consultant and health summary stay
>   at `LOW` deliberately** (3% and 0.3% of spend; prose and the recall tiles). A test pins that
>   boundary.
> - **`TIERS.paid` 2,000,000 → 1,000,000.** At $3.99 with Apple's 15%, net is $3.39, and a 2M
>   ceiling is ~$15 — **4.4× the revenue it protects.** A ceiling above net revenue is not a
>   ceiling, it is a maximum loss.
>
> Effect on the heaviest real month measured: **$3.10 → well under $0.50**, falling further as the
> cache warms.
>
> ⚠ **Two hazards built against, both silent.** A cache key narrower than the prompt serves one
> car's answer for another's — so a test reads the prompt itself and asserts every interpolated
> value is a key field. And only a *clean parse* is cached: `details` starts as placeholder text
> ("Performance gains will vary"), fine to show once on a parse failure and a thirty-day lie if
> served to every other owner of that car.
>
> ⚠ **The dossier call is still absent from all of these numbers**, because it has never
> completed. It is the biggest single call in the product. Measure it the first time research
> succeeds.
>
> #### What is left on E8
>
> `expo-iap` and the store adapter — the last piece, and it needs App Store Connect products
> before a purchase can be tested. Everything it plugs into is built, tested and live: the state
> machine, JWS verification, the pinned Apple root, the envelope parser, the entitlement writer,
> both routes, the purchase logic and the paywall. ⚠ **`PaywallScreen` is built and tested but
> nothing routes to it** — wire it when the adapter lands. **E6** (upgrade prompt, ~0.5 ed) is
> genuinely unblocked the moment IAP ships.
>
> #### Housekeeping
>
> - **`demo-live` is 2 commits behind** — missing the recall safety fix and the research fix.
>   Nothing there manifests either bug (all three demo vehicles have NHTSA rows), so it was left
>   deliberately rather than spending two builds.
> - ⚠ **Netlify credits passed 75%.** Seven builds on 20 Aug, **four of them avoidable** — the
>   banner gate was promoted separately from a promote a few hours earlier, doubling both sites.
>   The lever is batching promotes, not promoting per change.
>
> #### Instruments that caught real defects this week — all silent to review
>
> - `entitlement-not-user-writable` was satisfied by `getServiceRoleClient` appearing in a
>   **docblock** while the code used another client. Comments are stripped before the scan now.
> - The mobile runner's `testMatch` was `*.test.tsx`, so the first mobile test with no JSX **was
>   collected by nothing** — committed, typechecked, never run, jest green.
> - The JWS validity loop passed all sixteen tests while checking only the leaf.
> - `portability.test.ts` rejected a NOT_PORTABLE entry whose reason was a judgment rather than a
>   technical blocker. It was right to.
> - `tests-test-real-code.test.ts` refused a new source-scanner until it was allowlisted with a
>   justification.

> ### ⚠ 19 Aug — E8's server half shipped, and both hostnames are current
>
> **Everything below the next block predates this and its sequencing is older still.**
> This is the session that changed the most in one day; read it before acting on
> anything under it.
>
> ---
>
> #### What is now live on both hostnames
>
> | | |
> |---|---|
> | `crewchief.davidmasterson.co` | `83b7b24e` (`web-live`) — App Store URL + the app's API |
> | `crewchief-demo.davidmasterson.co` | `9a32aca2` (`demo-live`) — the portfolio piece |
>
> Both promoted 19 Aug through the scripted gates, both verified by fetching the
> pages rather than by reading the script's output. `verify-demo` passed against
> production with **the two standing warnings** (client-rendered content absent
> from initial HTML — the script's own comment says this is not a failure).
>
> ⚠ `/api/version` reports the **merge** commit on both, never the `main` commit
> named in the promote message. This has cost real time twice.
>
> #### The legal pages are finished — operator *and* contact
>
> `[OPERATOR NAME …]` and `[CONTACT EMAIL …]` had been rendering as literal body
> text on the page App Review reads since 17 Aug. Both are now named and live:
> **David Masterson** (settled by Apple's Individual enrolment — Q2 never gated
> it) and **`crewchief.support@gmail.com`**.
>
> ⚠ The contact is **deliberately not a domain address**, and that looks like a
> compromise without being one: `support@davidmasterson.co` carries David's name,
> which gives back most of what a dedicated address was for, and `crewchief.co`
> is not his. Apple requires a support **URL** in the listing, not a domain-based
> contact. It is verified receiving and delegated to his own mailbox.
>
> `LAST_UPDATED` is a **ship date, not an edit date**. It read 18 August for a day
> while the contact was still bracketed — and since nothing deploys from `main`,
> no reader ever saw it. A date describing a change readers could not see is the
> same defect as one preceding the change it describes.
>
> #### E8 — the entire server half is built, tested and live
>
> Seven commits. The decision layers are pure and were built first *because* they
> need no Apple credentials, so none of it waited on the membership:
>
> | | |
> |---|---|
> | `apple-subscription.ts` | notification → entitlement state machine, 21 tests |
> | `apple-jws.ts` | ES256 + certificate chain, on Node's own `X509Certificate`, **no new dependency** |
> | `apple-root-ca.ts` | Apple Root CA - G3, **committed rather than configured** |
> | `apple-notification.ts` | unwraps **all three** JWS layers |
> | `entitlement-store.ts` | the service-role writer `entitlement-not-user-writable` had been waiting for |
> | `purchase-flow.ts` | client decisions — `grantsAccess` true for **one** input combination |
> | two routes | `/api/v1/iap/verify` (401) and `/api/internal/apple-notifications` (400) |
>
> The four failure modes that have no error message, each mutation-verified:
> **Apple does not guarantee notification order** (a delayed `DID_RENEW` after an
> `EXPIRED` resurrects a dead subscription, silently); **a refund is not a lapse**;
> **a sandbox event must never overwrite a Production entitlement** — while App
> Review runs entirely in sandbox, so refusing sandbox outright is not available;
> and **an ignored notification must not advance the ordering clock**.
>
> ⚠ **A StoreKit success entitles nobody.** Only the server has checked Apple's
> signature, and the device is the party that benefits from lying about it.
>
> #### ⛔ The one thing that blocks E8 working in production
>
> **`20260818120000` is written and NOT applied** — verified against the live
> database 19 Aug, all five columns return `42703`. Until it lands, the webhook
> **refuses to write and returns 503**. That refusal is deliberate: without
> `last_signed_date` there is no ordering guard, and a degraded write is an
> entitlement a late retry can silently rewind. Apple retries for three days, so
> nothing is lost — but nothing is recorded either.
>
> #### ⚠ Found 19 Aug, not yet decided: web-live serves the demo framing
>
> `DemoBanner` renders unconditionally in `app/layout.tsx:137` — no environment
> gate, no hostname check. So **`crewchief.davidmasterson.co/privacy`, the URL in
> the App Store listing, carries a "PORTFOLIO DEMO · Shared demo garage"
> masthead**, and the root serves the three demo cars.
>
> Same failure shape as the operator placeholder: the unconditional banner was
> correct when there was one site and that site was the demo. The 17 Aug hostname
> split made it wrong on one of the two, and nothing announced it. There is
> currently **no variable that distinguishes the two sites**.
>
> A presentation risk rather than a rejection risk, but it is on the one page that
> can least afford ambiguity. **David's call**; it costs a promote.
>
> #### Instruments that caught real defects this session
>
> Worth recording, because each was silent to review:
>
> - `entitlement-not-user-writable` was satisfied by the words
>   `getServiceRoleClient` appearing in a **docblock** while the code used another
>   client — CLAUDE.md §5's `.tap-target-44` failure, reproduced by the first file
>   careful enough to document itself. Comments are stripped before the scan now.
> - The mobile runner's `testMatch` was `*.test.tsx`, so the first mobile test with
>   no JSX **was collected by nothing** — committed, typechecked, never run, while
>   jest reported every suite green.
> - The JWS validity loop passed all sixteen tests while checking only the leaf,
>   because every fixture shared one generation time.
>
> #### Next, in order
>
> | # | What | Who | Note |
> |---|---|---|---|
> | **1** | ~~Apply `20260818120000`~~ | — | ✅ **DONE — verified applied 22 Aug.** All five `account_entitlements` columns resolve against the live database (`last_signed_date`, `environment`, `revoked_at`, `auto_renew_status`, `latest_transaction_id`). The IAP webhook no longer 503s. This sat here as a ⛔ CRITICAL for three days after it had landed |
> | **2** | **App Store Connect setup** | **David** · weekend | Products matching `PRODUCT_TIERS` **exactly**, the notifications URL, a sandbox tester, App Review info. Setup sheet with the verified strings was delivered 18 Aug. ✅ The promote it depended on is already done |
> | **3** | **D2 — the price** | **David** | Standing recommendation $8.99/mo · $79/yr. Blocks creating the products, not the code: Apple returns a localised price and the app renders that |
> | **4** | **The `DemoBanner` decision** | **David** | Gate it on an env var (cleanest — the codebase has no site-distinguishing flag yet), gate on hostname, or leave it. Costs a promote |
> | **5** | **`expo-iap` + the store adapter** | Claude Code | The last of E8. A native module, so it **costs an EAS build**, and a purchase cannot be tested until 2 lands. Everything it plugs into is built and tested |
> | **6** | **E6 — the upgrade prompt** | Claude Code | ~0.5 ed, and **it is now genuinely unblocked** — it was correctly blocked on E8 because there was nothing to buy. `ai-budget.test.ts:174` asserts the limit message offers no upgrade; that assertion becomes wrong once 5 ships |
>
> ⚠ **Ordering that is not a preference:** CLAUDE.md §8 says a mobile build needing
> a new `/api/v1/*` route must be promoted first. That is **already satisfied** —
> both routes reached `web-live` on 19 Aug, before any build exists. Do not undo it
> by reverting the promote.


> ### ⚠ 17 Aug — what closed, and where the session is written up
>
> **RP4's browser-free half shipped** (`viewport-floors.test.ts`) and **RP2 was given the
> verdicts its own status line already had.** Item 5 closed. Three "do not regress" items
> gained a guard (`inclusive-affordances.test.ts`) — the three whose regression is invisible
> to whoever causes it.
>
> **Item 12 no longer needs a photographer.** Design settled it 17 Aug: store captures come
> from a photograph-free garage, illustrations carrying the heroes and plates the lists. The
> blocker was never the photo — it was the trademark caveat on recognisable marques, which a
> cheaper photo does not answer. **Item 18 is unblocked with what is already in the repo.**
>
> **Item 14's template has been delivered** as a spec by Design, so **R7 is buildable**.
>
> ⚠ **Item 13's remaining half was re-scoped and is smaller than written.** It says the
> cluster kit should enter `tokens.json` so React Native "inherits rather than re-derives"
> it. RN already does not re-derive it — both clients import
> `packages/core/src/cluster-geometry.ts` under a drift test. Design accepted the correction
> and split it: **core keeps the numbers, `tokens.json` gets the light** (band ramp, gauge
> colours, glow radii), because RN cannot read a CSS custom property.
>
> **The full session is §0.16b of the plan of record**, not here.
>
> ⚠ **This file is a plan of record, not a rulebook.** The working rules — the
> ones that have cost time, about verifying against the artefact rather than the
> board, what proves a commit, and which failures here are silent — now live in
> **`CLAUDE.md`** at the repo root, which is loaded every session.
>
> They were previously spread across three separate "Gotchas this session added"
> sections in this file, 400 lines apart, in a document long enough that its own
> status section and its item bodies disagreed for a fortnight without anyone
> noticing. That is the argument for moving them.

> ## ⚠ READ THIS FIRST — state as of 13 Aug 2026, 05:00
>
> **Everything below this block was written on 2 August.** Its design and responsive content is
> still the tree's record and still worth reading. Its *sequencing* is not, and it names work that
> has been dropped.
>
> **This file is authoritative on the tree. It is not authoritative on the plan.** The plan of
> record is **§0 of `~/Documents/Claude/Projects/davidmasterson.co/CREWCHIEF_ROADMAP_2026-08-02.md`
> (Rev. G)**. Start at its **§0.15 — the critical path**, which is seven ordered lines with an
> owner on each. Where the two files disagree about what to build next, §0 wins.
>
> ### Current state — re-derive before depending on any of it
>
> | | |
> |---|---|
> | `main` | → **`cb88f87`**, pushed (21 Aug). ⚠ **2 commits unpromoted to `web-live`, 4 to `demo-live`** — the safety/research fixes are live; the cost work is not |
> | Web tests | ~~2300~~ → **2616**, green (19 Aug) |
> | Mobile tests | ~~174~~ → **329**, green (19 Aug). ⚠ 10 of those were collected by nothing until 18 Aug — `testMatch` was `*.test.tsx`, so the first mobile test without JSX existed, typechecked and never ran while jest reported all suites green |
> | Typechecks | Three, all clean — ⚠ run the mobile one **from inside `apps/mobile`**; the root `tsc` resolves a different config and reports phantom errors |
> | Migrations | ⛔ **`20260821140000` (`mod_detail_cache`) WRITTEN, NOT APPLIED** — verified 21 Aug. The cost cache is inert until it runs; the code falls through to generating, so nothing breaks, but every day unapplied is full price. ✅ **`20260818120000` APPLIED 21 Aug by Cowork** and verified — five columns resolve, CHECK validated, `original_transaction_id` still UNIQUE, `authenticated` still SELECT-only. The IAP webhook can record. ~~⛔ written and NOT applied~~ — E8's five columns, all `42703` against live on 19 Aug. **This is the only thing stopping the IAP webhook recording anything.** ~~`20260813020000`~~ applied 16 Aug; ~~`20260815190000`~~ **applied** — re-probed live 19 Aug, `next_service_label` and `next_service_due_on` both present, so the entry below claiming it is outstanding is stale |
> | `demo-live` | ~~27 commits behind~~ → **current**, `9a32aca2`, promoted 19 Aug |
> | `web-live` | **current**, `f3278984` (21 Aug). Exists and has since 17 Aug — the note below saying it needs creating is dead |
> | `demo-live` | `eef03da7` — ⚠ **2 commits behind `main`**, deliberately |
>
> ### ⛔ Do not act on these — they are dead instructions below
>
> | It says | Reality |
> |---|---|
> | Build **5.2 Stripe checkout** | Dropped 8 Aug. Revenue is Apple IAP only |
> | **`brew install cocoapods`** | Never possible here. Routed around by EAS cloud builds |
> | Next.js upgrade is a **pre-submission gate** | It gates the web app, which is not what gets submitted. Track F |
> | "Phase 3 stays at ~16 remaining" | Phase 3 completed 5 Aug |
> | Erratum T2 blocks 5.2 | 5.2 is gone; the question returns at E7/E8 |
>
> ### The one thing blocking the most
>
> **`CRON_SECRET` is unset in production.** Confirmed 12 Aug by probing the deployed endpoint —
> an unauthenticated `POST /api/internal/notify-sweep` returns `503 {"error":"Not configured"}`,
> which that route emits **only** when the variable is absent. So the scheduler has fired daily
> since 8 Aug and nothing has ever been sent. It is David's to set; do not work around it.
>
> ### Rules that arrived with 12 August's work — read before touching these areas
>
> - **`lib/vehicle-research.ts` authorizes nothing, by design.** It spends a Pro-model call for
>   whatever vehicle it is handed. Two callers only, each authorizing differently;
>   `vehicle-research-callers.test.ts` keeps that list closed. **Never export it from a
>   `'use server'` file** — every export there is a public POST endpoint.
> - **The sweep must never generate under `?dryRun=1`.** A dry run that spends money is a trap
>   sprung by whoever is being careful.
> - **A dry run reports `recallsPlanned`, not `recallsSent`.** The latter only increments in the
>   delivery loop `dryRun` skips.
> - **`account_entitlements` must never become user-writable.** A scoped `FOR ALL` policy is
>   correct on every other table in this schema and is a free subscription on that one.
> - **`resolveTier` is deleted.** Use `resolveEntitledTier` from `@crewchief/core/entitlement`.
> - **A new table in `public` does not inherit the 1 Aug TRUNCATE revoke.** Carry its own
>   `REVOKE TRUNCATE … FROM authenticated`; `truncate-revoked.test.ts` fails the build otherwise.
> - **`/load-maintenance-data` returns two things that look like history.** `lineItems` is
>   `invoice_line_items` — description and price, **no service date**. The service record is
>   `maintenanceLineItems`. Reading the wrong one was a live bug until 12 Aug.
> - **When you fix something, grep for the comments that described it.** Four docblocks were found
>   asserting things that had stopped being true, three of them written by whoever had just made
>   them false.
>
> ### What landed 12 Aug, all pushed
>
> **C4** the sweep's regeneration gap · **E7** `account_entitlements` · **E5** deletion under an
> Apple subscription · **E4** the privacy manifest · **C5** the notification permission primer ·
> the mobile **wishlist "Done"** plus its chips and composer · the **service history screen** and
> record removal · the `ServiceMilestoneScreen` table fix · TRUNCATE revokes · two false docblocks.
>
> ⚠ **All of it is verified at the decision layer and unexercised at the surface.** Nothing built
> on 12 Aug has been rendered on a device — `apps/mobile/ios` has never been generated here. See
> §0.17 of the plan of record for exactly what each item is and is not proven by.

Source: `Live-Site Audit.dc.html` (2 Aug 2026), grounded in repo `davidmasterson303/crewchief@main` (aa1d73f) and the live demo. Finding refs (F1–F8) and concept refs (1a–1c, 2a–2c) point into that report. Advisor KB was offline for the audit; reconcile against it when reconnected, and stage a `kb_propose` for the decisions below.

---

## Status — 2 Aug 2026, afternoon session

**Live on production.** `crewchief-demo.davidmasterson.co` is serving `e7f14df7`
(the `demo-live` merge), promoted from `main` at `1ec6e68` through
`scripts/promote-demo.mjs`. All gate checks passed first time; `verify-demo.mjs`
green against prod afterwards, with the two standing warnings.

**The whole day is live** — RP1, R4, R8, R11, R12, Phase 2.95 a/b/c, 5.1, the
demo cap, the server-side photo bound, item 17's contrast fix, Phase 3.3's
account-deletion screen, and all four of Cowork's QA findings. Nothing is
sitting unpromoted.

**Verified on prod after the promote, at the widths that could not be reached
locally:** `/` at 375 — horizontal overflow 0 and `textUnder12px` **0**, down
from the baseline's 1, exactly as Cowork predicted when it identified that node
as the banner link. `/` at 700 — two 314px columns, against the single 652px
column it measured on `e729ee96`. `/consultant` at 375 — composer on screen,
thread scrolling, zero overflow in either axis.

| | Items | |
|---|---|---|
| **Done** | 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 16, 17 | 12 |
| **Partial** | 13, 15 | 2 |
| **Open** | 5, 12, 14, 18 | 4 |
| **Done (work stream B)** | RB0, R1, R2, R3, R5, R6, R9, R10, R15, R4, R8, **R11, R12** | 13 |
| **Invalid (work stream B)** | **R13, R14** — both target components nothing renders | 2 |
| **Open (work stream B)** | R7 — folds into item 14 | 1 |

**Work stream B is finished, except for a decision that is not a fix.** RB0,
RP0, RP1 and RP2 are all closed — R4, R8, R11 and R12 landed this afternoon.
**R13 and R14 are invalid**: both describe real defects in components that no
route renders, and the live equivalents do not have those defects. Deleting or
wiring those two components is David's call. R7 remains folded into item 14.

Every item below carries a status line. **Handoff notes are at the bottom of
this file** — read those first if you are picking this up cold.


## P0 — this week (portfolio-share and sign-up paths)

### 1. Fix the social preview image (F1)
> **DONE.** `metadataBase` added, reading `NEXT_PUBLIC_SITE_URL` with the production
> literal as fallback so an unset variable degrades to *correct for prod*, never back to
> localhost. `openGraph.images` is gone entirely — `app/opengraph-image.tsx` generates the
> card at build time and Next emits the tags itself. **Verified on prod:** og:image is
> absolute, returns 200 `image/png`, and the deployed HTML contains zero `localhost`.

- **Problem:** `app/layout.tsx` sets `openGraph.images` as a relative URL with no `metadataBase`, so deployed HTML resolves it to `http://localhost:3000/garage-interior-1920.jpg`. Every share card from the portfolio link renders blank.
- **Change:** add `metadataBase: new URL('https://crewchief-demo.davidmasterson.co')` to the metadata export in `app/layout.tsx`.
- **Verify:** view-source on the deployed page — `og:image` must be an absolute production URL; re-scrape with a link-preview debugger.
- **Effort:** one line.

### 2. Stop auth pages fetching the 480 KB master (F2)
> **DONE**, via the "real" change rather than the interim one — all five surfaces took the
> CSS plate, so they ship no photograph at all. Guarded by a new test
> (`lib/__tests__/image-weight-budget.test.ts`) that fails if any auth page or `/` ever
> references a raster file again.

- **Problem:** login (`:131`), signup (`:110, :172, :194`), forgot-password (`:46, :75`), reset-password (`:109`) all background `dark-roomb.jpeg` (3333×2000, 480 KB) behind a 60–85% black scrim. The 142 KB 1920-wide derivative already exists.
- **Change (interim):** point all seven refs at `/garage-interior-1920.jpg`.
- **Change (real):** these pages take the CSS plate (item 3) and stop shipping a photo at all.
- **Effort:** minutes.

### 3. Replace the backdrop with a built environment; delete the unprovenanced photo (§02)
> **DONE.** `.service-bay` in globals.css, `.service-bay-dim` on auth. Both JPEGs deleted
> (404 on prod, confirmed); `public/CREDITS.md` closed with the agreed wording.
>
> One deviation: the batten is **not** a layer of the plate. At the mockup's 440px height
> 12% landed exactly on the nav's bottom edge — that coincidence is the design — but at a
> real 720px viewport 12% is 86px, *inside* an opaque nav, invisible. It mounts on the nav
> as `.bay-batten`, which also collapses concept 2b into the same rule.

- **Problem:** the garage backdrop is the site's only asset with unknown provenance — photographer unknown, source unknown, EXIF stripped, "believed Unsplash" (indistinguishable from paid Unsplash+ post-download). `public/CREDITS.md`'s own recommendation is replace, not re-trace. It's also disliked aesthetically and is the main pop-in offender (F4).
- **Change:** ship concept **1a "Service bay"** as the backdrop on `/` — a CSS-built environment (graphite gradient base, one cyan LED batten with radial wash, wall/floor horizon hairline, sealed-concrete floor band with faint cyan reflection, faint wall-panel seams, vignette). Auth pages get a dimmed variant: LED wash at ~40%, deeper vignette — one variable.
- **Then:** delete `public/dark-roomb.jpeg` and `public/garage-interior-1920.jpg`; close the open item in `public/CREDITS.md` with "replaced by a built environment — no licence to record." Hold concept **1c "Cockpit ambient"** (brushed beltline + ambient strip) for the dashboard in P3 so the two screens rhyme.
- **Why CSS, not another photo:** 0 KB vs 142–480 KB per page; no licence ever; paints with the stylesheet (F4 dissolves); crisp at every viewport/DPR; tunable per surface.
- **Effort:** about half a day including deletion + CREDITS.

---

## P1 — next

### 4. Modern formats and sizes for all photography (F3)
> **DONE**, but not where the item said. `photography/build_assets.py` **does not exist and
> never has** — see the note under item 12. Written as `scripts/build-image-derivatives.mjs`
> (`npm run build:images`, needs the new `sharp` devDependency).
>
> 5.31 MB JPEG → 1.46 MB AVIF (73% smaller). Served via `image-set()` behind an
> `@supports` guard, not `<picture>`: the photo surfaces are CSS backgrounds, which no
> image component can express. The `unoptimized` flag stays and that is now a decision —
> the optimizer only sees `next/image`, and this app renders none. The `remotePatterns:
> '**'` wildcard was removed (it would have made `/_next/image` an open proxy the moment
> anyone dropped that flag).

- **Problem:** `next.config.js` sets `images: { unoptimized: true }`, nothing uses `next/image`, every photo is a fixed-size JPEG. Vehicle heroes run 660–950 KB (WRX portrait 948 KB).
- **Change:** extend `photography/build_assets.py` (already regenerates all derivatives from masters) to emit AVIF + WebP beside each JPEG; swap call sites to `<picture>` with JPEG fallback. Expect ≥50% weight reduction at equal quality.
- **Alternative:** verify the Netlify runtime version — if Runtime v5+, `next/image` is wired to Netlify Image CDN and the `unoptimized` flag may simply predate that; removing it could replace the manual pipeline. Check before building.
- **Effort:** ~1 day.

### 5. Preload any surviving LCP photo (F4 residue)
> **CLOSED 17 Aug — superseded, with the residue re-scoped rather than dropped.**
> The body below was already a complete account; what it lacked was a verdict,
> and an item nobody can act on reads as work outstanding. That is the same
> failure just corrected in RP2, one section up.
>
> **Verified before closing:** `fetchpriority` ships on the hero's request
> (`VehicleIdentity.tsx:296`, spelled lowercase and cast — React 18.2 has no
> camelCase prop and warns), the same treatment is on `GarageDoor.tsx:253`, and
> the blur-up fill is `vehicleBlurData` from `@crewchief/core/vehicle-blur`.
>
> **The residue, stated as its own thing:** a real `<link rel=preload>` for the
> dashboard hero is blocked on the dashboard server-rendering its vehicle, which
> is a change of a different size and is not this item. It belongs with a
> Lighthouse number that says it is worth having — i.e. behind item 15's still-open
> LCP half. Reopening this without that measurement would be optimising a
> figure nobody has taken.
>
> Original note follows.

> **OPEN — and largely moot, but not closed honestly.** `/` and the auth screens no longer
> carry a photograph at all, so the item is satisfied there by removal. The dashboard hero
> still does, and a static `<link rel=preload>` **cannot** name it: the URL comes from a
> client-side query and then a Supabase signed-URL exchange, so it is not knowable at HTML
> time. Injecting the link after the URL is known gains nothing over the browser's own
> discovery.
>
> What shipped instead, addressing the same symptom: `fetchpriority="high"` on the hero's
> request, and an inlined blur-up fill that paints before the photograph resolves.
> A real preload needs the dashboard to server-render its vehicle — a bigger change.

- **Change:** for any page that still carries a photographic backdrop or hero, add `<link rel="preload" as="image">` in the head (background-image in a client component is otherwise discovered post-hydration).
- **Effort:** ~1 hour.

### 6. Delete the Google image-search pipeline (F5)
> **DONE.** `lib/vehicle-images.ts` deleted, call site removed from `app/actions.ts`, both
> `GOOGLE_SEARCH_*` keys removed from `.env.example` (the env-parity ratchet checks both
> directions). `image_url` stays on the row and is still read as a fallback for the seeded
> demo vehicles — nothing writes it from a search any more.

- **Problem:** `lib/vehicle-images.ts` hotlinks whatever Google Custom Search returns for user vehicles — third-party images with no licence, from URLs that rot. The search key expired 28 Jul, so it already returns nothing; its Unsplash fallback URL 404'd in production (documented in the file's own comments).
- **Change:** remove the pipeline and its env keys. Owner upload (which already downscales client-side with EXIF orientation handled) plus the make-derived identity plate covers every case with zero third-party risk. `VehicleIdentity`'s docblock already declares the plate "the primary design, not the fallback."
- **Effort:** ~1 hour.

### 7. Cluster gauge replaces the donut (2a)
> **DONE**, hero and card both. `components/ClusterGauge.tsx`.
>
> Worth knowing: the "donut" the item describes is `ScoreRing` in `HealthSummary.tsx`, and
> it only renders in that file's `compact` branch, **which has no call sites** — D5 had
> already removed it from the dashboard. Replacing it would have restyled something nobody
> sees. What is actually on the dashboard was a numeral plus a separate linear band scale,
> and that is what the dial replaced.
>
> Built to the geometry in this file: viewBox `200×178`, butt caps, minors every 5, majors
> at 0/20/40/60/80/100 carrying the numbers, needle + hub. The reading sits below the hub —
> centring it in the well is not available once there is a hub, and the 178 crop is exactly
> the line it sits on.

- **Problem:** health is rendered as a closed 360° conic donut with rounded caps and drop-shadow glow — reads "SaaS progress ring," carries severity by color alone.
- **Change:** the 270° cluster dial, open at the bottom like a tachometer:
  - butt-capped arc stroke, hairline minor ticks every 5, majors at 0/20/40/60/80/100 carrying the numbers;
  - band thresholds 40/60/80 sit brighter on the dial;
  - needle + hub; numeral stays Inter tabular (`.num`) per the type rule; band token drives arc, needle position, numeral and label together (Good ≥80 / Fair ≥60 / Needs attention ≥40 / Critical <40 — never hand-labelled);
  - dashboard hero first; the garage card ring adopts the ticked dial at card size (56px slot) after.
- **Geometry (from the working concept):** viewBox 0 0 200 178, center (100,100), r=70; track `M 50.5 149.5 A 70 70 0 1 1 149.5 149.5`; score arc = same path with `pathLength="100"`, `stroke-dasharray="{score} 100"`; needle rotation = `2.7 × score − 135` degrees.
- **Effort:** ~1 day.

---

## P2 — later

### 8. Photo fade-in on signed-URL swap (F6)
> **DONE.** 200ms, keyed on the URL so a re-minted signed URL fades its replacement in
> rather than flashing the plate.
>
> Non-obvious: `onLoad` alone is a bug. This is a client component, so Next renders it to
> HTML on the server and the browser can finish fetching from cache *before* hydration
> attaches any handler — the event fires with nothing listening and the photo stays at
> `opacity: 0` forever. The element is also asked directly on mount, with `naturalWidth`
> separating a finished load from a finished failure.

- Signed-URL resolution collapses pending → "no photo," so the identity plate renders first and the photograph replaces it in one frame. Add a 200ms opacity fade on image load. Nothing else — layout stability is already right. (~1 hour)

### 9. Ambient hairline + machined wells + ignition sweep (2b, 2c, motion spec)
> **DONE**, all three. 2b turned out to be the same rule as the service bay's light
> fixture, so `.bay-batten` serves both and is mounted on the public nav and the dashboard
> nav — one accent edge per screen.
>
> 2c is `.machined`, and it applies to **two** surfaces rather than many. The spec says
> stat wells over `--surface-3`; this app has no population of those — dashboard stats are
> bare flex columns, and HealthSummary's panels are tinted washes where a white catch-light
> would muddy the tint. The primitive is in the system for the next well that appears.
>
> The ignition sweep is in the gauge, 0 → 100 → settle over ~900ms, reduced-motion aware.

- **2b:** the nav's bottom edge carries a single 1px luminous cyan hairline (gradient fading at both ends, soft 10px glow) — the one place glow lives on chrome; one per screen, same discipline as the serif rule.
- **2c:** stat wells take a machined top edge — 1px catch-light + ~30px gradient falloff over `--surface-3`; everything else stays matte; no glassmorphism, no new tokens.
- **Ignition sweep:** on dashboard load, once per session — needle sweeps 0 → 100 → settles on the score in ~900ms (ease-out return), arc draws in behind it, count-up in sync. Complements the scan line (scan = photo band, sweep = gauge; never both on one element). `prefers-reduced-motion` jumps to the settled state. Hooks exist in `use-count-up.ts` and the intro gate. (~half day total)

### 10. DEMO_IMAGES + migration deleted together (F8)
> **DONE — 2 Aug 2026, and the item's premise was inverted.**
>
> Closed by asking the database instead of the migration file. All three demo rows hold
> local paths — `/vehicles/{accord,wrx,m3}/hero-3x2.jpg` — and no Pexels URL survives in
> the column, so the migration has been applied everywhere. That was the condition the map
> was always waiting on. Reverting the migration, as this item asked, would have *restored*
> the Pexels URLs rather than cleared them.
>
> The real constraint was the map's own warning: do not simply fall back to `image_url`,
> because the column holds the page-width hero. `packages/core/src/photo-slots.ts` derives
> `card-800` from `hero-3x2` and `VehicleIdentity` applies it for the card variant only —
> the naming convention the map itself proposed, and the one the AVIF/WebP siblings already
> use. A rule rather than a table, because a table has to be kept in step with the seed
> data and a rule cannot drift from it.
>
> Verified in the browser: the grid requests two `card-800` AVIFs and no hero; the dashboard
> band requests the hero and no card. Both budget suites now exercise the shipped derivation
> rather than importing a constant.

### 11. Blur-layer derivative (F7, optional)
> **DONE**, and no longer optional — it shipped as part of item 16. The fill takes a 32px
> inlined WebP (`packages/core/src/vehicle-blur.ts`, generated), so the full-size file is
> decoded once instead of twice. Whole placeholder set costs 3 KB.

- `VehicleIdentity` decodes the same source twice (blur fill + sharp contain). Acceptable once P1 item 4 lands; optionally feed the blur layer a tiny (~64px) derivative. Fully closed by P4 item 15.

---

## P3 — next quarter: system coherence

### 12. Own the vehicle photography
> **OPEN.** Needs a photographer and a budget — not code. Unblocks item 18.
>
> **Related and newly discovered:** `photography/build_assets.py`, which this item and item
> 4 both reference, **has never been committed**. Not in the working tree, absent from
> `git log --all --diff-filter=A`, and not in `.gitignore`. `public/vehicles/CREDITS.md`
> had been instructing readers to run it, which is how the audit reached a wrong conclusion
> in good faith. That section now says so. The practical cost: the crop anchors and focal-Y
> values behind the existing derivatives exist **only inside the committed JPEGs**. If that
> script is on David's machine, committing it is worth doing before any re-shoot.

- One commissioned session for the three demo cars. Fixes both documented content errors — the Accord is an 8th-generation car standing in for the seeded 2018 tenth-gen Sport 2.0T (and its hard-orange sunset violates the photography spec), and the "M3" may be an F30 with M-Sport package rather than an F80 — and clears the trademark caveat (recognisable marques in store marketing) blocking App Store captures. Full assignment of rights; masters into `photography/masters/`, derivatives regenerated via `build_assets.py`, provenance recorded in `public/vehicles/CREDITS.md` as with the Pexels set.
- Fallback if a shoot doesn't happen: re-source correct-generation cars via the existing Pexels workflow (photographer + URL recorded before the file enters the repo; dark/neutral light, no people, no plates, no signage) — but the trademark caveat then still needs a decision before store assets.

### 13. Make garage and dashboard rhyme
> **PARTIAL.** The 1c beltline shipped — `.cockpit-belt` on the dashboard, so the public
> garage (1a) and the dashboard now share one environmental language.
>
> **Still open:** promoting the cluster kit into the design system and `tokens.json` for
> the React Native build, and updating the DS specs that still describe the donut. That is
> a different repo and was not touchable from here.

- Dashboard adopts the **1c** beltline backdrop (brushed-metal band + one ambient strip) so the public garage (1a) and the dashboard share one environmental language.
- The cluster kit — dial (2a), band scale with 40/60/80 ticks, ignition sweep — is promoted into the design system as real components and into `tokens.json`, so the React Native build inherits the cockpit language rather than re-deriving it. Update the DS specs that still describe the donut.

### 14. Onboarding template
> **OPEN.** Real design work on the first screen a paying user meets; not something to
> improvise at the end of a session.

- The design system's own flagged gap: no template exists for onboarding (or invoice scan, or maintenance history). Onboarding is the first screen a paying user meets and the last one still designed ad hoc — build it from the same tokens before the App Store push, with the cluster/plate language applied from the start.

---

## P4 — pre-launch: hardening & proof

### 15. Budgets in CI, not vigilance
> **PARTIAL.** The image-weight half shipped as `lib/__tests__/image-weight-budget.test.ts`
> (the promote gate already runs `npx jest`): auth surfaces and `/` must ship no raster
> file, the grid stays under 250 KB *as delivered in AVIF*, every JPEG must have both
> derivatives, and the AVIF/JPEG ratio must stay above 2 — which is how a silently missing
> `.avif` gets caught, since the delivered measure falls back to the JPEG.
>
> The promote gate also gained a share-card step: og:image must be present, absolute https,
> not localhost, and return `image/*` from the candidate's own origin. That is F1's guard,
> and it has to live in the gate rather than a unit test because `metadataBase` resolves at
> render time — a green local build proves nothing about what Netlify serves.
>
> **Still open: LCP and CLS.** They need a real browser against a deployed URL, which is
> slow and flaky on a cold Netlify function, and a red build from a noisy metric teaches
> people to re-run until green. Lighthouse CI is the right tool; it needs an owner for its
> flake budget.

- LCP and CLS thresholds plus a per-page image-weight budget, checked on every Netlify deploy preview (Lighthouse CI or equivalent), so an F2/F3-class regression can never ship silently again. The promote gate already exists and already reads build-time env — give it these numbers as a second criterion.

### 16. Finish the media pipeline
> **DONE**, except `srcset`, which was considered and declined with a reason. The three
> slots already resolve to purpose-built derivatives — `card-800` for a ~400px card,
> `hero-3x2` for the band — so the slot *is* the breakpoint, and at 800px against a 400px
> card the source is already 2x. Adding 1x variants would serve only non-retina displays,
> for twelve more committed files, after AVIF has taken the set down 73%. Revisit if the
> budgets ever say otherwise.
>
> `fetchpriority="high"` and the inlined blur-up both shipped; F7 is closed.

- `srcset` breakpoints for the card/detail/hero slots; `fetchpriority="high"` on the LCP image per page; a tiny inline (~64px, base64) blur-up derivative feeding `VehicleIdentity`'s fill layer — instant paint under the sharp copy, and F7's double decode of the full-size file is gone.

### 17. Accessibility pass on the new visuals
> **DONE**, all three parts, and the audit found two live bugs.
>
> **Contrast:** measured against the lightest pixel the plate produces, `rgb(31,29,26)`.
> White text at 50% alpha and above passes AA for normal text (5.13:1) — the plate is not
> the constraint. Below that it fails: 40% is 3.78:1, 30% is 2.71:1. Those alphas are
> app-wide tokens that predate this work and appear on surfaces the plate never touches, so
> raising them is a design-token decision, **reported not taken**. Worth a call with Design.
>
> **Reduced motion:** the three motions this item names were already fine. The audit found
> two that were not — `TCOCard` drew its ring over 1200ms through a `requestAnimationFrame`
> loop with no check at all (CSS cannot see rAF), and `ConsultantChat` scrolled with
> `behavior: 'smooth'`, which is *specified to override* the `scroll-behavior` the blanket
> rule sets. Both fixed. The list is now `lib/__tests__/reduced-motion.test.ts` rather than
> a list, because a list read once is per-feature memory with extra steps.
>
> **Forced colors:** the app had **zero** handling anywhere. That mode overrides SVG
> `fill`/`stroke`, so the gauge's track, arc, needle and ticks all collapsed to one colour —
> it did not break, it showed a full ring at every score. Re-stated in system colours
> (`Highlight` against `GrayText`) rather than opting out with `forced-color-adjust: none`.

- Contrast audit of text over the plates at their dimmest (auth variant) against WCAG AA;
- `prefers-reduced-motion` coverage verified across door intro, scan line, and ignition sweep as one audited list rather than per-feature memory;
- forced-colors / high-contrast mode on the gauge (ticks, needle, and band label must survive without color).

### 18. Store-capture production run
> **OPEN.** Depends on item 12 by definition.

- Marketing screenshots produced from the owned P3 photography, with the photography spec enforced (no sunset frames — the rule the current Accord breaks), plate-blur boxes applied, and the trademark posture decided and recorded. Captures reproducible from a script, same convention as `build_assets.py`.

---

## Sequencing logic
P0 removes the two user-visible embarrassments on the highest-traffic paths and retires the licence risk. P1 makes every remaining image cheap and kills the unlicensed acquisition path. P2 is polish that needs P1's pieces. P3 spends real money (photography) only after the system it feeds is coherent. P4 locks the results in with automated proof before the App Store push.

---

# Work stream B — responsive web (R1–R15)

Source: `Responsive Audit.dc.html`, 2 Aug 2026, read against `main`. Every route checked at 320 / 375 / 414 / 768 / 1024 / 1440. Line numbers are as-read on `main` — re-locate by the quoted class string, not the number, if the file has moved since.

**The diagnosis, in one line:** the app is not unresponsive, it is desktop-authored and reflowed by accident. There are **18 breakpoint decisions in ~5,300 lines** of the screens users actually spend time in; four screens have zero. The mobile work that *does* exist (drawer, edge-fade tab strip, `.tap-target-44`, `@media (hover: none)`) is all correct and all applied to exactly the one element that reported the bug.

**Do RB0 first.** Fifteen patches without the shared rules produces a sixteenth finding next month, and most of R1–R15 collapse into one-line edits once the rules exist.

## RB0 — the four rules to adopt before the patches
> **DONE — 2 Aug 2026.** All four written into `app/globals.css` by name so reviews can
> cite them. Rules 3 and 4 are enforced in CSS there; rules 1 (the ladder) and 2 (the
> container scale) are conventions the markup carries, and RP1 is the pass that applies them.


Add to `app/globals.css` and to the DS spec, then reference by name in review.

1. **The ladder** — four widths, named by what changes, not by device:
   `base` one column / 16px gutter · `sm 640` two-up cards, full chrome · `lg 1024` three-up, sidebars appear · `2xl 1536` four-up, wider shell. `md` is a transition, not a design target — nothing may *first* appear at `md`.
2. **The container scale** — every nesting level steps down exactly once below `sm`:
   page `px-4 sm:px-6 lg:px-12` · panel `p-4 sm:p-6` · card `p-4 sm:p-5` · tile `p-3 sm:p-4`.
3. **Three floors**, lintable: **16px** any focusable input at ≤640 · **12px** any rendered text · **44px** any interactive target.
4. **Touch parity** — a control revealed by hover must have a non-hover path. One utility (`.reveal-on-hover`), and never `display:none` on an action.

---

## RP0 — this week (~1 day, all four are edits to shared code)

### R2. Every text field zooms the page on iOS and never zooms back — CRITICAL
> **DONE.** Pointer-scoped exactly as specified. The composer's `text-sm` was removed at the
> call site rather than the rule marked `!important` — verified it now carries no size utility
> and resolves through `.field`. The "do not use `maximum-scale`" warning is written beside
> the rule in the stylesheet, not only here.

> Highest visible-impact-to-effort ratio in the whole audit. Do it first.

- **Problem:** mobile Safari zooms the viewport when a focused input is under 16px and does **not** restore scale on blur. `.field` is 14px (`globals.css:876`), `.field-sm` 13px (`:931`), and the chat composer passes `text-sm` as a utility (`ConsultantChat.tsx:975`). Tapping the composer, conversation search, a mileage edit or any onboarding field jerks the layout and leaves the user on a horizontally-scrolled page for the rest of the session.
- **Not the viewport meta.** Next emits `width=device-width, initial-scale=1`, which is correct and stays. And `globals.css:876` already **predicted this exact bug** and deferred the call ("16 has an argument… belongs to whoever wants it, not to a primitive refactor"). Design owns it now: **16px on touch pointers, 14px kept for mouse-driven desktop.**
- **Change:** scope to the pointer, not the width —
  ```css
  /* iOS Safari zooms any focused input under 16px and never restores scale.
   * Pointer-scoped so mouse-driven desktop keeps its 14px density: a 500px
   * desktop window has no zoom rule to satisfy, a 1024px tablet does. */
  @media (hover: none) and (pointer: coarse) {
    .field, .field-sm, textarea, select, input[type="text"],
    input[type="email"], input[type="number"], input[type="search"] { font-size: 16px; }
  }
  ```
  The chat `Textarea` needs its `text-sm` class **removed** (a utility beats a bare selector), not the rule marked `!important`.
- **Do NOT fix it with `maximum-scale=1` or `user-scalable=no`.** Both stop the zoom by disabling pinch-zoom entirely — fails WCAG 1.4.4 and undoes the accessibility work in item 17. The field scale is the fix.
- **Verify:** iOS Safari, or Chrome device emulation with touch emulation on — focus each field, confirm `visualViewport.scale` stays 1; then confirm pinch-zoom still works.
- **Effort:** 20 minutes.

### R1. Dialogs cannot scroll and touch both edges of the phone — CRITICAL
> **DONE.** Primitive fixed once; all six local `vh` overrides deleted. Measured at 375×812:
> 326px wide, 25px backdrop each side, `max-height: 690.2px` (85dvh), `overflow-y: auto`,
> 16px radius.

- **Problem:** `components/ui/dialog.tsx:41` is stock shadcn — `w-full max-w-lg`, −50% translate centring, `p-6`, **no `max-height`, no `overflow`**. Any dialog taller than the viewport overflows past the top *and* bottom with no way to reach either end: clipped, not scrolled. At 375px the panel is exactly 375px wide, flush to both edges, and `sm:rounded-lg` means square corners below 640px. **Ten** dialogs inherit it unguarded, including the two longest flows in the product (`DocumentUploadDialog:257`, `VehiclePhotoUploadDialog:245`). Six others set `max-h-[90vh]` locally — right instinct, wrong unit: `vh` is the *largest* viewport on iOS, so 90vh still runs under the URL bar.
- **Change:** in the primitive, once —
  ```diff
  - 'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg … p-6 … sm:rounded-lg'
  + 'fixed left-[50%] top-[50%] z-50 grid w-[calc(100%-2rem)] max-w-lg
  +  max-h-[85dvh] overflow-y-auto overscroll-contain … p-5 sm:p-6 rounded-2xl'
  ```
  Then **delete** the six local `max-h-[90vh]` / `[80vh]` overrides — the base handles it, and leaving them re-introduces the `vh` bug.
- **Verify:** open the document-upload dialog at 375×667 with a long form; both the title and the submit button must be reachable, and 16px of backdrop must show on each side.
- **Effort:** ~1 hour for all ten.

### R3. Vehicle-info spec tiles collapse to a column of single letters — CRITICAL
> **DONE.** Both sites. Measured at 375px: one column, 227px per tile, against the ~0 the
> text column used to resolve to.

- **Problem:** `app/vehicle-info/[vehicleId]/page.tsx:189` and `:234` are a bare `grid grid-cols-3` with no breakpoint. From the 231px a card gets at 375px (see R6): each column is 66px, of which a 32px icon, a 12px gap and 32px of tile padding are already spent. The text column resolves to ~0 and "8-speed automatic" wraps one character per line.
- **Change:** `- grid grid-cols-3 gap-4` → `+ grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4`, both sites.
- **Effort:** 10 minutes.

### R5. Three controls a touch user can never reveal — CRITICAL
> **DONE.** `.reveal-on-hover` added and `.meta-edit` / `.turn-actions` now share its
> declarations. The named-group warning was real — the selector carries `.group\/image:hover`
> as well, or the card's photo overlay would have been missed. Verified: 18 controls, none
> still on a `group-hover` utility, all pinned under `(hover: none)`.

- **Problem:** `VehicleCard.tsx:316` (photo overlay), `:417` (⋮ menu) and `MaintenanceHistory.tsx:382` (delete record) are `opacity-0 group-hover:opacity-100`. No hover on a phone, so **delete vehicle, change photo and update mileage have no mobile entry point at all** — and adding the photo the whole identity-plate design depends on is impossible from the garage.
- **Change:** the system already solved this — `.meta-edit` (`globals.css:828`) and `.turn-actions` (`:1019`) both pin visible under `@media (hover: none)`, with the reasoning written down. Generalise it instead of adding a third copy:
  ```css
  .reveal-on-hover { opacity: 0; transition: opacity var(--duration-fast); }
  .group:hover .reveal-on-hover,
  .reveal-on-hover:focus-visible { opacity: 1; }
  @media (hover: none) { .reveal-on-hover { opacity: 1; } }
  ```
  Retire `.meta-edit` and `.turn-actions` into it so the next hover affordance inherits the touch behaviour rather than re-deriving it. Note `VehicleCard` uses the named group `group/image` — keep the name or the selector misses.
- **Verify:** DevTools → Rendering → emulate `hover: none`; all three controls visible and tappable.
- **Effort:** 20 minutes.

---

## RP1 — next (~2 days, mechanical once RB0 exists; do it in one pass, not per screen)

> **DONE — 2 Aug 2026, afternoon (`8456afe`).** All four, in one pass as asked.
> Came in nearer two hours than two days, because RB0 had already done the
> deciding. Details on each below; two things were left undone deliberately and
> both say so.

### R6. No container in the chain gets smaller below `sm` — HIGH
> **DONE.** RB0 rule 2 across 7 page shells (`px-4 sm:px-6 lg:px-12`) and 20
> panels (`p-4 sm:p-6`). Measured on the public garage: `main` padding 24px →
> 16px below `sm`, still 24px at and above it, no horizontal overflow at either.
>
> **The 199px → 271px claim is not re-verified.** That chain is on the
> dashboard, which is behind auth and could not be measured from a session with
> no credentials. The rule is applied everywhere the grep finds; the number is
> still the audit's, not a fresh measurement.
- **Problem:** four nested containers each take 24px a side and none steps down — `DashboardLayout.tsx:281` (`px-6 lg:px-12`), `:404` (`glass-panel p-6`), every `Card` (`p-6`), inner tiles (`p-4`). At 375px: **375 → 327 → 279 → 231 → 199**. 53% of the device is nested gutter. R3, R8 and R13 are all this finding wearing a different component.
- **Change:** apply RB0 rule 2 everywhere. 375px then yields **271px** of content instead of 199px (+36%).
- **Verify:** grep for `\bp-6\b` and `px-6` with no `sm:` sibling; the count should reach zero outside desktop-only blocks.
- **Effort:** ~2 hours.

### R9. The 44px utility exists and is used six times — HIGH
> **DONE.** Nav tabs → `py-3 min-h-[44px]` at 13px, which closes an R10 site in
> the same edit. Nine icon and pill controls gained `.tap-target-44`; adoption
> 12 → 22. The ⋮ vehicle menu was already fixed by RP0's R5 work.
>
> **One control deliberately did not get the utility, and the reason
> generalises.** The consultant's follow-up chips wrap at `gap-2`.
> `.tap-target-44` centres a 44px `::after` on its element, so on a ~30px chip
> it overhangs ~7px top and bottom — into an 8px gap, from both sides. Two rows
> of chips would have had *overlapping hit areas*, and the tap goes to whichever
> pseudo-element paints last. A control that answers the wrong tap is worse than
> one slightly too small, so those grew for real (`py-2.5 min-h-[44px]`).
>
> **Read the utility's docblock as binding:** "any small chip that is a real
> standalone tap target". A wrapped row is what that qualifier excludes, and it
> is worth checking before the next application.
>
> **Still open:** the lint rule. `_adherence.oxlintrc.json` is in the DS repo and
> was not touchable from here, so this is still a review comment rather than a
> check — the exact shape of decay this file keeps warning about.

- **Problem:** `.tap-target-44` (`globals.css:791`) is correct and barely adopted. The **primary navigation misses the floor**: tab links are `px-4 py-2.5 text-xs` ≈ 36px tall (`DashboardLayout.tsx:268`), on the one control every signed-in session touches. Also under 44px: ⋮ vehicle menu 32px (`VehicleCard.tsx:417`), performance refresh 32px (`vehicle-info:219`), maintenance delete 36px, chat "New" 28px, composer attach + send.
- **Change:** tabs → `px-4 py-3 text-[13px] min-h-[44px]` (visual weight unchanged, and it fixes an R10 site at the same time). Icon buttons → add `.tap-target-44`; it expands the hit area, not the glyph.
- **Then:** add it to the lint set — an interactive element under 44px with no `.tap-target-44` is a review comment, not a taste question. `_adherence.oxlintrc.json` in the DS is the place.
- **Effort:** ~2 hours.

### R10. Thirty uses of 10 and 11px type, none of them decorative — HIGH
> **DONE, to the 12px floor.** All of it to `text-xs`.
>
> **It was 54, not thirty** — across seventeen files, not five. The audit named
> the five worst (`ConsultantChat` ×12, `UpcomingMaintenance` ×10,
> `TierProgressCard` ×9, `CostBreakdownTable` ×5, `DemoBanner`) and those were
> right; the tail was twice as long. 54 is the number to carry forward.
>
> **Still open: the second half of the change line.** "Data and labels on mobile
> → 13px" is not a mechanical pass — it needs a judgement per site about what
> counts as data. Only the hard floor landed. `ClusterGauge`'s band label went
> to 12px with the rest and is worth a look on a card, since it is a verdict
> rendered in an abbreviated form to fit.

- **Problem:** `UpcomingMaintenance` ×10, `ConsultantChat` ×12, `CostBreakdownTable` ×5, `DemoBanner`, `TierProgressCard`. The DS's smallest token is `--text-body-xs: 12px`, so all of it is off-scale — and it carries due dates, cost estimates, conversation timestamps, table headers and the "Get Quote" action. At 10px on a dark surface at arm's length it is not quiet, it is unreadable, and it contradicts a brand voice where the numbers carry the argument.
- **Change:** `text-[10px]` / `text-[11px]` → `text-xs` (12px) as a hard floor; data and labels on mobile → 13px. **Contrast, not size, makes a label recede** — `text-muted-40` at 12px reads quieter than white at 10px and stays legible.
- **Effort:** ~2 hours.

### R15. One 600px-wide card at tablet width; three at 1440 — MEDIUM
> **DONE (`3dd9743`), and the change line as written was incomplete.**
>
> Measured before, at 700px: `grid-template-columns` computed to `none` — one
> card, exactly as described. After: two 314px cards on the live garage.
>
> **The `2xl` column needed the shell widened, which the change line does not
> say.** Adding `2xl:grid-cols-4` alone puts four columns inside `max-w-7xl`,
> which does not grow past 1280px — the cards come out ~290px, *narrower than
> the 338px the same card gets at 700px in two-up*. A fourth column that shrinks
> every card below its tablet size is a regression wearing a fix's clothes. RB0
> rule 1 already says the answer — "2xl 1536 four-up, **wider shell**" — so the
> two `<main>` elements take `2xl:max-w-[96rem]`. Measured at 1600: 1536px
> shell, four 342px cards.
>
> Scoped to the two routes' own `<main>`, not `DashboardLayout`'s container, so
> nothing else inherits a width change it was not audited for.
>
> Verified at four widths: 375 one column · 700 two · 1440 three, shell still
> 1280, no horizontal overflow · 1600 four.

- **Problem:** `app/page.tsx:158` (`gap-6`) and `app/garage/page.tsx:128` (`gap-8`) both run `md:grid-cols-2 lg:grid-cols-3` and **skip `sm` entirely**, so 640–767px renders a single column of enormous cards — the worst-looking width in the product, and where a landscape phone and a small tablet both land. Above 1280px `max-w-7xl` caps the row at three, leaving gutters where a fourth column belongs. The two grids also disagree about their gap.
- **Change:** one grid, both routes — `grid gap-5 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4`.
- **Effort:** 20 minutes.

---

## RP2 — after (~4 days; these need design, not a prefix)

> ⚠ **Reconciled 17 Aug — this document disagreed with itself.** The status
> section already said *"RP0, RP1 and RP2 are all closed — R4, R8, R11 and R12
> landed this afternoon"* (§ 2 Aug status, line ~108), while every item body
> below still read as outstanding, three of them as CRITICAL or HIGH. R13 and
> R14 had their own verdicts; the other four had none.
>
> Nothing was re-planned. The code was checked and the verdicts written where
> the reader actually looks, with line-number evidence per item.
>
> Worth naming as a failure mode rather than a tidy-up: a summary line 500 lines
> from the item it summarises is not where anyone reads a status. Somebody
> scanning for the next CRITICAL finds R4, and spends a day rebuilding a
> consultant layout that already carries its own `R4.` comment explaining the
> fix. **A stale board is not neutral — it buys work that is already done and
> hides what is genuinely left.**

### R4. The consultant is a fixed 520px box inside a scrolling page — CRITICAL
> **DONE.** `ConsultantChat.tsx:694` is
> `h-full md:h-[calc(100dvh-320px)] md:min-h-[520px] md:max-h-[760px]`, and the
> shell it sits in is `DashboardLayout`'s `mobileLayout="app-shell"` (`:32`,
> `:217`) — the viewport is the frame below `md`, so the thread is the only
> thing that scrolls. The composer is `shrink-0` with
> `pb-[max(1rem,env(safe-area-inset-bottom))]` (`:1087`). The sidebar becomes a
> drawer rather than taking 256px of a 375px viewport.
>
> The in-file comment records the measurement that mattered: **the composer
> began 860px down a 692px viewport.**

> Critical by impact, but scheduled here because it is a layout rebuild, not an edit.

- **Problem:** `ConsultantChat.tsx:609` is `h-[calc(100vh-320px)] min-h-[520px] max-h-[760px]`. On a 667px phone the calc yields 347px, so `min-h` wins and the panel is 520px — inside a page whose demo banner, nav, tab strip, vehicle title and meta row have already eaten ~400px. **The composer sits below the fold: you scroll the page to type and the thread to read.** Two scroll contexts stacked on the flagship feature. `100vh` also measures the URL-bar-collapsed viewport, so the panel exceeds the visible area on first paint.
- **Change:** below `md`, the consultant route becomes an app shell —
  ```
  shell    h-[100dvh] flex flex-col overflow-hidden
  thread   flex-1 min-h-0 overflow-y-auto
  composer shrink-0 pb-[env(safe-area-inset-bottom)]
  panel    h-auto md:h-[calc(100dvh-320px)] md:min-h-[520px] md:max-h-[760px]
  ```
  The page title, meta row and surrounding `glass-panel` padding should **not render** below `md` — a chat screen on a phone is chrome + thread + composer. Keep the existing drawer behaviour (`:621`) untouched; it is already right.
- **Verify:** 375×667 with the keyboard up — composer visible without page scroll, thread scrolls under it, no rubber-banding of the page behind.
- **Effort:** ~half a day.

### R8. A five-column cost table in 231px, inside `overflow-hidden` — HIGH
> **DONE.** `CostBreakdownTable.tsx:81` — below `md` it is a card per line item,
> the table above it. Its own header (`:47`) makes the point the change line
> implies: the two are genuinely different layouts of the same data, not one
> layout with a prefix.
- **Problem:** `CostBreakdownTable.tsx:55–63` — Item · Parts · Labor Hrs · Labor Cost · Total, `text-[11px]` headers, every cell carrying a low *and* a high figure. The wrapper is `overflow-hidden`, so the usual escape hatch (let it scroll sideways) is actively closed. This is the artefact the consultant produces to justify an estimate — it *is* the answer — and on a phone it is a stack of clipped numerals.
- **Change:** a card per line item below `md`, the table above it. Same data, same order, no horizontal scroll:
  ```
  Brake pads & rotors, front          ← description, 15px
  Parts     $180 – $240               ← label/value rows, right-aligned .num
  Labor     2.0 – 2.5 hr · $260
  Total     $440 – $500               ← band-weighted
  ```
  Keep `<table>` at `md`+ where the column scan is the point. Do not "fix" this by removing `overflow-hidden` — a sideways-scrolling estimate is not an answer either.
- **Effort:** ~3 hours.

### R11. A 36px page title over a four-up meta row — MEDIUM
> **DONE.** `DashboardLayout.tsx:441` is `text-2xl sm:text-4xl lg:text-5xl`, and
> the meta row below it is a grid before it is a wrapped flex — both exactly as
> the change line specifies, both annotated `R11` at the call site.
- **Problem:** `DashboardLayout.tsx:296` is `text-4xl lg:text-5xl`, so a phone gets 36px for "2018 Honda Accord" in 279px — three lines before the trim appears. `:303` puts Mileage / Avg monthly / Status / Reliability in `flex flex-wrap gap-8`, which wraps to a ragged 2 + 2 with 32px gutters.
- **Change:** `h1` → `text-2xl sm:text-4xl lg:text-5xl`; meta row → `grid grid-cols-2 gap-x-6 gap-y-5 sm:flex sm:flex-wrap sm:gap-8`.
- **Effort:** ~1 hour.

### R12. The breadcrumb — and with it the way back — is hidden below 640px — MEDIUM
> **DONE.** The full breadcrumb is still `hidden sm:flex` (`DashboardLayout.tsx:285`)
> — correctly, because the phone got its **own** compact one rather than a
> squeezed copy of the desktop control (`:127`, `:257`). The way back exists at
> every width, which was the actual complaint.
- **Problem:** `DashboardLayout.tsx:236` is `hidden sm:flex`. Garage › vehicle › page plus the scrolled health-score pill all vanish on a phone; what remains is a logo that happens to be a link. The comment above it records that four separate routes back to the garage were consolidated into this one control — which is then `display:none` on the viewport where a back affordance matters most.
- **Change:** below `sm`, one row — `‹ Garage · Accord · 61` (chevron-left + parent + short name + score pill, `min-h-[44px]`). Full breadcrumb returns at `sm`.
- **Effort:** ~1 hour.

### R13. Service rows drop the date and truncate the job — MEDIUM
> **INVALID AS WRITTEN — `components/MaintenanceHistory.tsx` is not rendered
> anywhere.** Nothing imports it: no `<MaintenanceHistory`, no import of
> `@/components/MaintenanceHistory` or `./MaintenanceHistory`, no
> `dynamic()`/`lazy()` reference, in `app/` or `components/`. It exports a
> default that no file consumes. The only mention left in the tree is a comment
> in `CollapsibleSection.tsx`.
>
> **And the live page does not have this defect.**
> `app/documents/[vehicleId]/page.tsx` renders the service history itself and
> contains no `hidden sm:`, no `truncate` and no date formatting at all — the
> date is printed plainly, which is the thing R13 asks for.
>
> The fix was written and then reverted rather than committed. Editing a
> component nothing renders is work that looks like progress, cannot be
> verified by any flow, and would leave the file looking maintained.
>
> **This is item 12's failure again, one layer over.** That entry records
> `photography/build_assets.py` as "never committed… which is how the audit
> reached a wrong conclusion in good faith". Same shape: the audit read source
> and inferred that reading it meant it ran.
>
> **David's call, and it is a scope decision rather than a fix:** delete
> `MaintenanceHistory.tsx` and `UpcomingMaintenance.tsx`, or wire them up if
> they were meant to be reached. R13 and R14 only become real after that.
>
> **Taken for `UpcomingMaintenance.tsx` — deleted, see R14.** This file is the
> one left, and the decision is still open on it.
- **Problem:** `MaintenanceHistory.tsx:347–376` keeps one line and pays for it — date `hidden sm:flex`, part number `hidden sm:inline`, description `truncate`, beside a category badge and a right-aligned cost. A maintenance record with its date hidden has the second-most-important fact removed, on the screen whose whole job is "what was done, when, for how much."
- **Change:** two lines below `sm`, one line above —
  ```
  Front brake pads & rotors              $486.20
  Ken's Auto · 14 Mar 2026 · Brakes
  ```
- **Effort:** ~2 hours.

### R14. A 260px carousel that fits neither phone nor desktop — MEDIUM
> **CLOSED BY DELETION — `components/UpcomingMaintenance.tsx` is gone.** The
> item was invalid as written: the component was not rendered anywhere either.
> Same evidence as R13, and the claim that it "is the only horizontally-
> scrolling region in the app" was the tell — the only live `overflow-x-auto` in
> `app/` or `components/` outside it are the dashboard's tab strip, which carries
> `edge-fade-x` deliberately, and `EmailDraftDisplay`. There was no carousel on
> any screen a user could reach.
>
> A fix was written and reverted first, for the reason under R13. The decision
> that entry asked for has now been taken in the delete direction: the component
> and `LogServiceModal.tsx`, its only child and the sole reason that file
> existed, are both removed. `packages/core/src/service-due.ts` already replaces
> the approach — it reads the vehicle's own schedule rather than the hardcoded
> `COMMON_INTERVALS` table this component carried, which is the argument for
> deleting rather than wiring up.
>
> **`MaintenanceHistory.tsx` is still there**, so R13 is still open on the same
> terms.
- **Problem:** `UpcomingMaintenance.tsx:136`, `:415` — fixed `w-[260px]` cards in a snap scroller. At 375px that leaves a 19px sliver of the next card: too little to read as "more," too much to read as an edge. At 1440px the same strip scrolls through four items while 600px of row sits empty. It is the only horizontally-scrolling region in the app and it scrolls at *every* width.
- **Change:** below `sm` → `w-[78vw] max-w-[300px] snap-start` (a legible next-card peek); `md`+ → `grid grid-cols-2 xl:grid-cols-3`, no scroller.
- **Effort:** ~1 hour.

---

## RP3 — with onboarding (~1 day) — folds into item 14

### R7. Onboarding has no responsive markup at all — HIGH
- **Problem:** `components/OnboardingWizard.tsx` — **856 lines, zero breakpoints**, the least responsive file in the repo and the first screen a paying user meets. The step rail (`:50`) sets five 32px circles with `text-[10px] whitespace-nowrap` labels beneath; "Powertrain" and "Performance" are wider than their circles, so below ~420px the labels overlap. Year/Make is `grid-cols-2` (`:438`); mileage presets are `grid-cols-4` (`:586`) — four ~60px buttons carrying four-digit numbers.
- **Change:** do **not** add prefixes to 856 lines. Build it from the DS onboarding template (item 14 / the DS's own flagged gap) with these decisions baked in:
  ```
  rail     below sm → "Step 3 of 5 · Mileage" + a 2px progress bar
           the dotted rail is a desktop affordance, not a small one
  fields   grid-cols-1 sm:grid-cols-2
  presets  grid-cols-2 sm:grid-cols-4, min-h-[44px]
  actions  full-width stacked buttons below sm
  ```
- **Dependency:** merge this item with item 14 rather than tracking both. Closing 14 closes R7.
- **Effort:** ~1 day (inside item 14's estimate).

---

## RP4 — pre-launch (~half a day) — extends item 15

### A viewport matrix in CI, beside the LCP/CLS budgets
> **PARTIAL — the browser-free half shipped 17 Aug as
> `lib/__tests__/viewport-floors.test.ts`**, registered in
> `STATIC_ANALYSIS_SUITES` as the change line asks.
>
> **Landed:** no rendered text under 12px (arbitrary sizes in both `px` and
> `rem`; `app/dev/` exempt and named, for the one 9px illustration caption), and
> no focusable field under 16px — checked three ways, because R2's fix has three
> separate ways to come undone: the pointer-scoped rule being deleted, a call
> site out-specifying it with a utility (**how the bug shipped the first time**),
> and someone reaching for `maximum-scale=1` / `user-scalable=no`. The third is
> the one worth having: it *works*, so the change looks like a fix, and nothing
> on the resulting page says it has failed WCAG 1.4.4.
>
> ⚠ **One finding, and it was the guard being wrong rather than the app.** The
> first scan failed `components/ui/input.tsx` for `file:text-sm` — which styles a
> file control's `::file-selector-button`, not the field's own text, and cannot
> cause the zoom. Pinned as its own case, because a guard that cries wolf on an
> invisible rule gets made to pass rather than read.
>
> **Still open:** no horizontal overflow and no interactive target under 44px.
> Both need real layout and ride with item 15's Lighthouse CI owner, as written.

- 320 · 375 · 768 · 1440, asserting: **no horizontal overflow** (`scrollWidth <= clientWidth` on `body`), **no interactive target under 44px**, **no rendered text under 12px**, **no focusable input under 16px at ≤640**. Static analysis covers the last two cheaply — the same pattern as `image-weight-budget.test.ts`, and it registers in `STATIC_ANALYSIS_SUITES` the same way. The first two need a real browser, so they ride with item 15's Lighthouse CI owner.
- Then this audit cannot happen twice.

---

## Already right — do not regress these

Nine deliberate pieces of responsive work are already in the codebase. The recommendation above is to **generalise** them, not replace them.

> **All nine verified present 17 Aug**, and **three are now guarded** by
> `lib/__tests__/inclusive-affordances.test.ts`.
>
> The filter was not importance — it was visibility. A regression in those three
> is invisible to whoever causes it: nobody develops in Windows High Contrast or
> with a coarse pointer, so a rename that unhooks the forced-colors block leaves
> a clean diff, a page that looks right, and a dial showing **a full ring at
> every score**. The other six regress in front of you the moment you resize a
> window, and a test is the wrong tool for those.
>
> The sharpest of the three checks that the CSS still names classes
> `ClusterGauge.tsx` actually renders — a stylesheet hooked to nothing reviews
> perfectly and applies to nothing, the same shape as a font face named but
> never loaded.
>
> ⚠ Writing it caught the guard passing on a **comment**: the first
> `.tap-target-44` in `globals.css` is 600 lines above the rule, inside the
> prose describing it. Anchored to the declaration.

| What | Why it is right | Where |
|---|---|---|
| Consultant sidebar → drawer | Reclaims 256px of a 375px viewport; overlay + handle, static at `md` | `ConsultantChat:621` |
| Scrollable tab strip + edge fade | Mask scoped to ≤640 so desktop tabs are not dimmed for nothing | `globals.css:1069` |
| One tab strip, not two | Duplicate nav deleted rather than timed around | `DashboardLayout:261` |
| `.tap-target-44` | Expands hit area without inflating the glyph | `globals.css:791` |
| `@media (hover: none)` | Applied to `.meta-edit` / `.turn-actions`, reasoning written down | `globals.css:828`, `:1019` |
| Photo hero reworked at ≤640 | Contain-not-crop, blur fill, tint dropped, content inset to 18px | `globals.css:691` |
| Service visit rows | Genuine `flex-col md:flex-row` — the pattern the rest should copy | `documents:238` |
| Collapsible dashboard sections | Folded sections with summaries — right answer to a long mobile page | `dashboard:166` |
| Reduced-motion + forced-colors | Honoured at the token layer, ahead of most products this size | `globals.css:307`, `:1391` |

---

## Breakpoint matrix as found

**Broken** = a task cannot be completed. **Degraded** = completable, visibly wrong.

| Route | 320 | 375 | 414 | 768 | 1024 | 1440 |
|---|---|---|---|---|---|---|
| `/` landing | Degraded | OK | OK | OK | OK | OK |
| `/garage` | Broken | Broken | Broken | Degraded | OK | Degraded |
| `/dashboard/:id` | Broken | Degraded | Degraded | Degraded | OK | OK |
| `/consultant/:id` | Broken | Broken | Broken | Degraded | OK | OK |
| `/documents/:id` | Degraded | Degraded | Degraded | OK | OK | OK |
| `/vehicle-info/:id` | Broken | Broken | Broken | Degraded | OK | OK |
| `/onboard` | Broken | Broken | Degraded | OK | OK | OK |
| Settings · auth | Degraded | Degraded | OK | OK | OK | OK |
| Dialogs (10 of 16) | Broken | Broken | Broken | Degraded | OK | OK |


---

# Handoff — 2 Aug 2026, night (final session)

**Read this one.** Two earlier handoffs are kept below — the ~19:38 "end of day"
entry, which was written before this session and is now superseded on state, and
the morning's, kept for its gotchas. Neither "what I would pick up first" list is
current.

## Where things stand

- `main` = `6e1d727`, working tree clean. **Two commits are unpromoted**:
  `1cb0d31` (2.98) and `6e1d727` (traffic-class split).
- Production serves `e7f14df7` = `main @ 1ec6e68`, promoted 19:33 through the
  full scripted gate. **Verified from the artifact, not the report**: `--no-ff`
  merge with parents `f09a0ef6` and `1ec6e68b`, subject byte-identical to
  `promote-demo.mjs`'s own format, and — the load-bearing part — **an empty
  body**, where a waived AI gate would have written `AI GATE WAIVED with
  --allow-degraded-ai`. So the consultant round-trip ran and passed.
- **64 suites, 1110 tests, green.** `npm run typecheck` clean. `npm run build`
  clean, all routes compiled.
- Two stale worktrees under `.claude/worktrees/`, both behind `main` with nothing
  ahead. Prunable.

## ⚠ David's list — one migration is time-sensitive

1. ~~**Apply `20260802200000_split_ai_usage_by_traffic_class.sql`.**~~
   ✅ **APPLIED — verified against the live database 17 Aug, not read off the
   folder.** `ai_usage_events.surface` exists and is discriminating: over the
   most recent 219 rows, `account` 193, `canary` 19, `demo` 6, `anonymous` 1,
   recording continuously from 2 Aug 21:09Z. Nothing was blended.

   ⚠ **This entry spent a fortnight telling David to go and do something that
   was already done, under a ⚠ heading calling it the one item that gets worse
   by waiting.** That is the second dead instruction on this four-item list —
   item 2 was struck for the same reason. A list that keeps urgent-looking
   completed work is not merely untidy: it spends the reader's attention on the
   items that do *not* matter, which is exactly how the one that does gets
   missed.

   ⚠ **A real one, found while checking this:** `surface = 'canary'` rows appear
   on 8 and 15 Aug and nowhere else. The six-hourly canary workflow had never
   fired, because it sat on the `canary-workflow` branch and **Actions only runs
   `schedule` from the default branch**. Landed on `main` on 17 Aug (`55213ff`).
   It still needs `CONSULTANT_HEALTH_SECRET` in **two** places — GitHub Actions
   *and* Netlify — see 5 below.
2. ~~**`brew install cocoapods`** — unblocks the simulator and the rest of Phase 3.~~
   ⛔ **DEAD — do not run this.** It was never possible: macOS ships Ruby 2.6, CocoaPods needs
   ≥ 3.0, and there is no Homebrew on this machine. **Routed around by EAS cloud builds on
   4 Aug**, and Phase 3 completed 5 Aug. This instruction has sent David to a terminal for a
   command that cannot succeed more than once.
3. **A dashboard read for erratum T2**, blocking 5.2:
   `select tablename, policyname, cmd, roles, qual from pg_policies order by tablename;`
4. **Review the KB queue** — `cd ~/Developer/advisor-kb && node dist/cli.js queue`.
5. ⚠ **Set `CONSULTANT_HEALTH_SECRET` in two places, or the canary stays red.**
   Verified by running it by hand on 17 Aug: the deployed endpoint answers
   `{"status":"broken","reason":"NOT_CONFIGURED"}`, and the canary exits 3 —
   *"the deployment has no CONSULTANT_HEALTH_SECRET set"*.
   - **GitHub** → repository *Actions* secret, so the workflow can authenticate.
   - **Netlify** → environment variable on the **`crewchief-demo`** project —
     the one deploying `demo-live`, *not* `effulgent-blancmange-6adfdf` which
     deploys `main`. Two CrewChief sites exist and the split is deliberate
     (`scripts/promote-demo.mjs` gates the public demo behind main; it is 70
     commits and nine days back as of 17 Aug). The canary watches the demo on
     purpose. Setting this on the main site leaves the canary red while looking
     done.

   The two values must be identical. Setting only the Actions secret leaves the
   canary failing forever while looking configured.

*The `ai_usage_events` migration is **already applied** — recording since
2 Aug 21:09Z, and schema-verified in the ~19:38 handoff below. It was still
listed as outstanding in the ~14:30 handoff and in Rev. E when this session
started, which is why item 1 above is worth reading carefully rather than
pattern-matching to "the migration is done".*

## What landed this session

| Commit | What |
|---|---|
| `1cb0d31` | **2.98a/c/d** — the quote pull, its instrumentation, and V1 deleted |
| `6e1d727` | **Traffic-class split** on `ai_usage_events` — `surface`, and the canary out of the price dataset |

Documents, outside the repo: the full 2 Aug day landed in `CREWCHIEF_STATUS.md`;
Rev. E's state table corrected and errata T1/T2 applied; ten KB proposals staged
(`p-20260802194500-rev5`, queue 1/25); `CREWCHIEF_FEATURES.md` corrected.

## The finding worth carrying: an average across two populations measures neither

The first eight metering rows read 583 visible tokens against 2,012 thinking —
**3.45×**, after 2.95a had set a thinking level. I published that number in
`CREWCHIEF_STATUS.md` as "thinking is running 3.45× the visible answer, after
2.95a", and it was read — reasonably — as evidence that 2.95a had only half
landed and that D2's clock was running on a half-fixed system.

It had fully landed. Grouped by purpose:

```
health_check (canary)   5 rows    40 visible/call   296 thinking/call   7.34x
consultant (real)       3 rows   127 visible/call   177 thinking/call   1.39x
── blended ──           8 rows                                          3.45x
```

**Real traffic was at 1.39× the whole time**, essentially the target. The canary
asks a fixed question and gets a ~40-token answer while thinking is roughly a
fixed cost per call, so its ratio is a property of the probe rather than of the
model — and it was 5 of the 8 rows, so it dominated.

Three things generalise from this:

1. **A ratio metric is unsafe on short-answer paths.** Thinking-per-call is the
   stable number; thinking-to-visible is not, because the denominator moves for
   reasons that have nothing to do with cost.
2. **Never aggregate a synthetic probe with real traffic.** That is what the
   `surface` column now prevents structurally, rather than by remembering.
3. **I reported an aggregate without checking whether it was one population.**
   The check took one query. The cost of not doing it was a day of the roadmap
   carrying "2.95a may have only half-landed" as an open risk.

## The real 2.95a gap, which is smaller and different

**The level shipped is `LOW`, not `MINIMAL`** — six of the seven `withThinking`
call sites (only the lite-model classifier at `app/actions.ts:776` uses
`MINIMAL`). So the ~73.6% reduction anyone expected was for a setting the code
does not use.

The bench in the previous session measured, on the same prompt:

```
unset 861  ·  HIGH 726  ·  LOW 424  ·  MINIMAL 0
```

So **`LOW` cuts ~51% against unset, and `MINIMAL` cuts 100% — zero thinking
tokens.** The economics document's 73.6% figure matches neither and is cited
there as *reported* rather than measured; the bench is the better source and the
doc should be corrected to it.

**`LOW → MINIMAL` is a real remaining lever, but it is a quality decision, not a
cost one.** Zero thinking tokens on the consultant may or may not survive the
round-trip gate, and eight rows is not a basis for deciding. Vision is already
deliberately left with no level at all, for the documented reason that a
regression there is invisible — fewer line items still returns valid JSON and
still passes every gate.

## Gotchas this session added

1. **`purpose` and `surface` are orthogonal and it is worth keeping them so.**
   `purpose` says which *feature* spent the money; `surface` says whose traffic
   it was. The instruction that produced this work said "add a `purpose` column",
   but `purpose` already existed and answers the other question. A consultant
   call can be demo, real or anonymous, costs the same to serve, and means three
   different things to a price.
2. **`surface` defaults to `account`, deliberately.** A future call site that
   has not been taught about the column lands in the bucket that *counts* toward
   cost. Over-counting a price input is visible and recoverable; under-counting
   it produces a confident, cheap, wrong number.
3. **The derivation order in `deriveSurface` is load-bearing and tested.** A
   signed-in user browsing the demo garage is still an `account` — their calls
   cost real money against a real person who might pay. Reversing the `userId`
   and demo-vehicle checks would quietly move real spend into an excluded
   bucket.
4. **`generateQuoteRequestV2` takes wishlist ids**, so the consultant pull can
   only offer items that were actually added. Items without an id are filtered
   rather than sent, which is why the affordance can disappear again after an
   add. Both add outcomes carry an id — 201 returns the row, 409 returns
   `itemId` — and the 409 is a normal path, because the dossier and the
   consultant suggest the same job.
5. **A preselection effect keyed on an array re-runs forever.** Callers build
   `preselectedItemIds` inline, so it is a new identity every render; keying the
   effect on it stamps the preselection back over the user's own tick-boxes
   while the dialog sits open. It is keyed on the joined string instead, and the
   fourth test in `quote-pull-preselection.test.ts` is what catches that being
   undone.
6. **There is no analytics product in this application.** No PostHog, no
   Plausible, no event pipeline — only the structured logger. This matters
   beyond 2.98c: the roadmap makes funnel instrumentation a **ship gate** for
   the anonymous front door, and that substrate does not exist. Now sized at
   0.75 ed, and **the cost is anonymous visitor correlation**, which also does
   not exist — `checkRateLimit` takes a caller-supplied string, not an IP or a
   cookie. Four events without a join key are four counters, not a funnel.

## Two documents that were wrong, and how they got that way

**`CREWCHIEF_FEATURES.md` claimed a capability that does not exist.** *Service
items and costs* pitched "compare that against what you were quoted" — there is
no stored quoted figure anywhere in the schema, and `estimateCosts` has exactly
one caller, inside `generateQuoteRequestV2`. **That sentence is where roadmap
task 2.98b came from.** The claim did not merely misdescribe the product; it was
read as a specification and produced a task that was costed, sequenced and
partially planned before anyone checked the tree. It is the second false
capability claim found in that file.

An audit of the whole file — 109 symbols named in `how:`/`pitch:` lines, checked
against the tree — found **no third false capability claim**, but **ten stale
`lib/` paths** left over from the Phase 2.4 move into `@crewchief/core`.
`lib/onboarding.ts` was among them, and the knowledge base corrected exactly that
path on 28 July: the fix reached the KB and never reached the features file. All
ten now resolve.

**A build-time guard does not generalise, for a structural reason.** The obvious
model is `provenance-claims.test.ts`, which fails the build if the app renders an
unsubstantiated provenance badge. It cannot be copied here: `CREWCHIEF_FEATURES.md`
is not in the repository, and `FeaturesDrawer.tsx` carries none of the pitch copy,
so the build cannot see the artifact. Making it a *test* means moving the file
into the repo first — a real decision, since it is the document sent to other
people.

So it is a script instead, alongside `audit-rls.mjs`, which is not in CI for the
same class of reason:

```
node scripts/audit-feature-claims.mjs
```

**It catches drift, not falsehood**, and says so on every clean run. Neither of
the two false capability claims would have failed it. Three things it learned the
hard way, all recorded in its own comments:

- **A path-like symbol is a claim about the filesystem, not about source text.**
  Grepping file *contents* for `packages/core/src/prompts.ts` always misses; the
  first run reported six false negatives on paths that were perfectly correct.
- **A "not a real path" category will swallow a real reference if you let it.**
  An earlier version matched URLs on "has dots" and quietly absorbed
  `storage-paths.test.ts`. Source extensions now win over every category.
- **An `internal:` note legitimately names things that are gone.**
  `uploadInvoiceForCompletion` "used to write `invoices/{file}`" is a correct
  sentence about a path that must *not* exist. Symbols that fail to resolve on a
  line narrating a change are reported as historical rather than stale — printed,
  never dropped, because that heuristic could in principle hide a real defect.

## Still open, in priority order

> ⚠ **Reconciled 11 Aug — items 1 and 2 have both moved.** The rest hold. Current
> state is §0.4 of the plan of record.

1. **Erratum T2** — ~~blocks 5.2~~ **5.2 is dropped, so T2 blocks nothing today.**
   **Re-scoped, not closed:** the same question — what an *authenticated* caller
   whose subscription lapsed can reach — returns under Apple IAP at Track E's
   E7/E8. Ask it there. The anon RLS audit run in this session found no non-demo
   rows reachable across 25 tables and `vehicle-documents` is private, but
   **that evidence does not touch the actual question**, and it must not be used
   to close T2 whenever it does come back.
2. ~~**Phase 3 stays at ~16 remaining.** Built is not proven, and the simulator has
   never run.~~ ✅ **Phase 3 completed 5 Aug and is proven end to end.**
   The two diagnoses recorded here are still worth keeping, because both were
   wrong in instructive ways: **the blocker was never `xcode-select`** (that
   diagnosis was wrong twice — do not run the simulator tool's suggested `sudo
   xcode-select -s`, it is already the current selection), **and it was not
   CocoaPods either.** CocoaPods was never installable on this machine — Ruby
   2.6 against a ≥ 3.0 requirement, no Homebrew — so the real answer was to stop
   trying to build locally at all. **EAS cloud builds routed around the whole
   question on 4 Aug**, and Phase 3 closed the day after.
3. **2.98b is undecided, not dropped.** ✅ **Decided 8 Aug — dropped, option A.**
   The spec described a comparison the code cannot make: there is no stored
   quoted figure anywhere in the schema.
4. **`LOW → MINIMAL`** on the non-prose paths, once the round-trip gate can
   speak to quality. *(Still open.)*
5. **5.1's remaining half** — the upgrade-prompt UI. *(Still open, now tracked as
   Track E's E6. No longer blocked on pricing: revenue goes through Apple IAP,
   so the price is Apple's product record rather than a hard-coded figure.)*

---
---

# Handoff — 2 Aug 2026, ~19:38 (evening session, superseded on state)

**Superseded by the entry above**, which was written after two more commits
landed. Its "where things stand" is accurate as of 19:38 and wrong now in three
specific ways, all corrected above: `main` has moved to `6e1d727`, the test
count is 64/1110, and **two commits are unpromoted** rather than none.

Kept in full because everything else in it holds: the promote verification, the
afternoon's commit table, its schema check on the applied metering migration,
and its gotchas.

## Where things stand

- `main` = `1ec6e68`, pushed. Working tree clean.
- **Production serves `e7f14df7`**, promoted from `main @ 1ec6e68` through the
  full gate. `verify-demo.mjs` green against prod afterwards, two standing
  warnings. **Everything in this document is live** — nothing is sitting
  unpromoted.
- 62 suites, 1090 tests, green. `npm run typecheck` clean.
- **Two stale worktrees** under `.claude/worktrees/` (`confident-shtern`,
  `friendly-lewin`). Both are *behind* `main` with nothing ahead — checked, no
  stranded work. Prunable whenever.

### Verified on prod after the promote, not just locally

- `/dashboard` — 44 rendered text nodes, **0 failing WCAG AA**
- `/` at 375 — horizontal overflow 0, `textUnder12px` 0
- `/` at 700 — two 314px columns (was one 652px column)
- `/consultant` at 375 — composer on screen, thread scrolling, no overflow
- demo consultant answered anonymously through the new cap, and the meter
  recorded it — the first `purpose: 'consultant'` row in `ai_usage_events`

## What landed this afternoon

Eighteen commits across three tracks — design, cost, and mobile. The design
track was the visible half; the cost track is the one that changes the unit
economics.

| Commit | What |
|---|---|
| `92f56e2` | **2.95b** — invoices are reduced before the extractor sees them |
| `3dd9743` | **R15** — two-up at `sm`, and a wider shell at `2xl` |
| `b5d1c53` | **2.95a** — an explicit thinking level, and the gate that proves it |
| `02c78cf` | A return-type fix, and a correction to `b5d1c53`'s own claim |
| `8456afe` | **RP1** — R6, R9, R10 in one pass |
| `bb83782` | **2.95c** — every Gemini call metered, per account |
| `4947512` | **R4** + **NEW-01** — consultant app shell; banner stops widening the page |
| `2a315cc` | **NEW-02** — the closed garage door is inert, not just opaque |
| `fec351b` | **NEW-04** — last four hover-only reveals, plus a build check |
| `9b8cf8f` | **NEW-03** — QA script corrected against the tree it will next be run on |
| `1a691e7` | **R8** — cost breakdown becomes cards below `md` |
| `680b5a9` | **R11 + R12** — phone-sized title, and the way back |
| `7aa60a6` | **R13/R14 invalid** — both target components nothing renders |
| `0fe7248` | **5.1** — a monthly ceiling on AI spend, per account |
| `7f1f0ce` | **Phase 3.3** — account deletion reachable in-app (Apple 5.1.1(v)) |
| `d756780` | **Demo cap** — two windows, one pool, degrades rather than breaks |
| `47af5c4` | Stored photo size bounded server-side |
| `1ec6e68` | **Item 17** — body text raised to the AA floor, measured |

## Cowork's QA report — triaged

**Read this before acting on that report: it was run against `main 7630d42`,
which predates every commit in the table above.** Its jest count (979/979, 57
suites) is the morning tree; this one is 1035/59.

| Finding | State |
|---|---|
| R9, R10, R15 "reproduce exactly as described" | **Already closed here** by `8456afe` and `3dd9743`. True of that tree, not this one |
| **NEW-01** banner overflows at 320/360/375 | **Fixed** (`4947512`). Verified 0 overflow at 320 |
| **NEW-02** focus enters the garage behind the closed door | **Fixed** (`2a315cc`) |
| **NEW-03** B2 fails as written | **Closed** (`9b8cf8f`). Cowork was right that the check is the defect: the field computes 16px because `input[type='text']` at (0,1,1) outranks `.text-xs` at (0,1,0). B2 now asserts computed size |
| **NEW-04** four hover-only reveals never migrated | **Closed** (`fec351b`), and B8 with it — that grep is now `touch-parity.test.ts` and the build runs it |

**All four are closed.** `docs/qa-script.md` has been corrected in the same
pass: its §0 now separates open from closed-on-main, its §2 baseline is marked
stale wholesale with the three wrong cells named, and the header says to run
against the candidate rather than prod until a promote happens.

**One correction to fold back into `docs/qa-script.md`:** its §2 baseline records
`/` @375 `horizontalOverflow: false`, and that cell was wrong when written —
NEW-01 was present at the time, and the same row's `textUnder12px: 1` *is* that
banner's link. The other two baseline deltas Cowork lists (25 vs 16 sub-44px
targets, 346 vs 348px grid) are theirs to re-derive.

**And a finding against my own work, worth keeping:** RP1's 12px type floor made
NEW-01 *worse* before it was fixed. Cowork measured the overflowing link at
126px against `text-[10px]`; at `text-xs` it is 147px, so the 4px overflow it
reported at 375 would have become ~14px. The floor was right and stays. Two
correct rules can still collide, and the collision showed up in a QA run rather
than in either change.

### The two findings worth carrying, whatever you pick up next

**1. The consultant health check was testing the wrong model.**
`/api/health/consultant` hardcoded `'gemini-2.5-flash'` while the consultant ran
`FLASH_MODEL` (3.6). The canary answered "is some model reachable" while
reporting "is the consultant working" — it would have stayed green straight
through a 3.6 outage. Fixed in `b5d1c53`, and `ai-thinking-level.test.ts` now
fails the build if a literal comes back. **This is the `cc-product-0003` lesson
landing on an instrument, and it is the third time.**

**2. A thinking level is a 400, not a hint.** Sending one to a 2.5 model returns
`INVALID_ARGUMENT — "Thinking level is not supported for this model."` The
generation configs are shared across model families, so the obvious version of
2.95a — adding `thinkingConfig` to `flashConfig` — takes out every 2.5 call site
at once, and `tsc` is perfectly happy about it. Always go through
`withThinking`; never write `thinkingConfig` by hand.

## Measured, not assumed

- **Thinking tokens, `gemini-3.6-flash`, same prompt each time:** unset **861** ·
  HIGH 726 · LOW 424 · MINIMAL 0, against ~150 tokens of visible answer. Thinking
  bills at the output rate. `unset` costing more than `HIGH` is not a typo.
- **Through the shipped code path:** consultant 743 → 449 thinking tokens, answer
  the same length. The guard emits no `thinkingConfig` key at all for 2.5.
- **The round-trip gate passed against the real model:** *"The consultant
  answered with vehicle-specific facts: 41,200, Stage 1, Stage 1 tune"*, 3.5s.
- **R15 at four widths:** 375 one column · 700 two (was **one** — measured
  `grid-template-columns: none` before the change) · 1440 three, shell still
  1280, no overflow · 1600 four at 342px.
- **R6:** `main` padding 24px → 16px below `sm`, 24px at and above.

## Gotchas this session added

1. **`.tap-target-44` is not safe on a wrapped row.** It centres a 44px
   `::after`, so on a ~30px chip it overhangs ~7px each side — into an 8px
   `gap-2`, from both directions. Two rows get overlapping hit areas and the tap
   goes to whichever paints last. Grow the control for real instead. The
   consultant's follow-up chips are the worked example.
2. **Four-up at `2xl` needs the shell widened or it is a regression.**
   `max-w-7xl` stops at 1280px, so a fourth column just makes every card ~290px
   — narrower than at 700px in two-up. RB0 rule 1 says "wider shell" and means it.
3. **Documents are not photos.** `downscaleImage` at its photo defaults (1600px,
   quality floor 0.5) is tuned for a car in a 400px card. An invoice is read, not
   looked at; it gets `DOC_MAX_EDGE` 2048 and a byte budget sized so it stops on
   the first quality rung. Do not collapse the two constants.
4. **Vision is the one 3.x path with no thinking level, on purpose.** Invoice
   extraction is where a regression is invisible — fewer line items still returns
   valid JSON and still passes every gate. The corpus to settle it exists
   (`COWORK_PROMPT_invoice_vision_corpus_2026-07-30.md`). Measure, then set one.
   It is now metered under `invoice_extraction`, so the cost half of that
   question answers itself once the migration is applied.
5. **A test that reads a migration must strip the comments first.** The first
   draft of `ai-usage.test.ts` asserted the file contains no `USING (true)` and
   failed on the migration's own comment *saying* it contains no `USING (true)`.
   It was reading prose and reporting it as schema — the same instrument failure
   this file keeps recording, this time caught in the instrument being written.

6. **Two ceilings, two different failure modes, one shared rule.** Both the
   per-account budget and the demo cap treat a **non-positive limit as "not
   configured", never as "spend nothing"** — read literally, a config typo would
   silence the public demo instantly. Both also **fail open** on a read error:
   what is being protected is a bill, not a security boundary, and the
   per-minute rate limit is still underneath. The honest consequence is that
   both ceilings are best-effort and under-report.
7. **A responsive duplicate must compute its numbers once.** R8 renders the cost
   breakdown as cards below `md` and a table above. Two presentations of the
   same figures drift, and here drift is worse than the bug it fixed — a phone
   showing a different total from the desktop is legible and wrong, and someone
   takes it to a shop.
8. **Bundle output is real evidence when a screen cannot be run.** `expo export`
   plus `strings` on the `.hbc` proved the new Account screen *and* its
   cross-package `@crewchief/core` import are genuinely in the iOS binary. It is
   not a substitute for rendering it, and the roadmap says so.

## Decisions waiting on David — nothing else is blocked on code

1. **5.0 — entity, terms, privacy policy.** *The* binding constraint now.
   2.95 a/b/c and 5.1 are done, so the money track's code is ahead of its
   decisions: 5.2 cannot ship to a real card without this, and it is the only
   item whose duration nobody controls.
2. **The primary button fails AA.** "Sign up" is white on `bg-cyan-600` at
   **3.68:1**; `bg-cyan-700` measures **5.36:1** and closes it. Deliberately not
   changed — `bg-cyan-600` is at 36 sites, so it is the brand colour on every
   primary button, and that is a design decision rather than something to slip
   into an accessibility pass.
3. **The dead components — one down.** `UpcomingMaintenance.tsx` is deleted,
   and `LogServiceModal.tsx` with it: nothing else rendered the modal, and its
   only insert named a column that has never existed under a `source` the CHECK
   forbids. R14 is closed. `MaintenanceHistory.tsx` is the remaining one —
   delete it or wire it up, and R13 only becomes real after that.
4. **D2 (price) after two weeks of meter data**, per Addendum A. The first rows
   already show thinking at 5–8× the visible answer *at `LOW`*, which argues for
   re-testing `MINIMAL` on the non-prose paths once there is a fortnight to read.
5. **Re-upload the M235i photo** in the app, whenever convenient. It is the one
   stored photo predating the browser downscale — 2,328,761 bytes — and
   re-uploading it now shrinks it. Thirty seconds, no code.

## The metering migration — applied

`20260802150000_meter_ai_usage_per_account.sql` was applied to production on
2 Aug and verified against the live schema: table present, 11 columns, 3
indexes, RLS enabled, one policy, the purpose CHECK present, and
`authenticated` holding SELECT only with `anon` holding nothing.

Confirmed working end to end rather than taken on report — rows are landing,
including a `purpose: 'consultant'` row written by prod traffic after the
promote. **The two-week clock on D2 starts from 2 Aug.**

## What I would pick up first, in order

Everything below is unblocked code unless marked. The blocked items are in
"Decisions waiting on David" above.

1. **Run the mobile Account screen.** It is the only thing shipped today that
   has never been rendered — see the Phase 3.3 section below for exactly how far
   it *is* verified, and for the `xcode-select` false alarm not to repeat. **Do
   not press the final delete**: one real account, no throwaway.
2. ~~**5.2 — Stripe checkout (3 ed).** The next code item on the money track, and
   the largest remaining. Blocked from *shipping* by 5.0 but not from being
   built; D2 should be settled first so the price is not hard-coded twice.~~
   ⛔ **DROPPED 8 Aug — do not build this.** The product pivoted to mobile-first,
   sold through the App Store. The web app is a free companion that takes no
   money, so there is no checkout to build. **Apple IAP is the only revenue
   mechanism now.** The server-side entitlement gating survives as Track E's E7.
3. **2.95d — window the consultant context (1.25 ed).** Size it against the
   meter rather than the guess, per Addendum A. Gate the consultant round trip
   before and after: a worse-grounded answer is still a well-formed answer.
4. **The R10 tail** — data and labels to 13px on mobile. Needs a judgement per
   site, which is why only the 12px floor landed.
5. **Next.js upgrade (3.5–6 ed).** ~~Still a pre-submission gate.~~ **Re-scoped
   8 Aug: it gates the *web* app, and the web app is no longer what gets
   submitted.** Real work, still worth doing, but off the critical path — Track
   F. Taking money does not make 13.5.11 more acceptable and does not move it
   earlier either.
6. **The R9 lint rule** in `_adherence.oxlintrc.json`. It is in the DS repo, so
   the 44px floor is still a review comment rather than a check — the one guard
   from this session's work that did not get automated.

## Phase 3.3 — account deletion, and how far it is verified

**Built and bundled, not run.** `AccountScreen` is one tap from the garage and
`DELETE /api/v1/account` is wired. What has actually been checked:

- mobile `tsc` clean; web 62 suites / 1090 tests green
- the confirmation rule, the inventory and the summary are shared from
  `packages/core/src/account-deletion.ts` and unit-tested — the web dialog
  imports them rather than keeping its own copy, because **Apple reviews the
  mobile surface** and two implementations let the reviewed one drift weaker
- `npx expo export --platform ios` bundles clean, 636 modules, and the shipped
  `.hbc` contains "Delete my account", "Signed in as", "Every consultant
  conversation" and "Your account has been deleted" — so the screen *and* the
  cross-package core import are genuinely in the binary, not tree-shaken

**Not verified: it has never been rendered.** No simulator run, no tap-through.
Treat 5.1.1(v) as built-not-proven until someone launches it.

> **Do not chase `xcode-select` on this Mac.** The simulator MCP tool reports
> "Xcode is installed but not selected" and asks for
> `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`. **The Mac
> is already configured correctly** — Xcode → Settings → Locations shows
> *Command Line Tools: Xcode 16.3 (16E140)*, `xcode-select -p` returns the
> Xcode path, and `xcrun --find simctl` resolves into `Xcode.app`. The tool's
> precondition check is what is wrong.
>
> Two signals that look like evidence and are not: `xcrun --show-sdk-path` with
> no argument returns the default *macOS* SDK, which Command Line Tools
> legitimately provides, and `/var/db/xcode_select_link` is absent on a machine
> that is nonetheless correctly selected. I read both as faults and sent David
> to fix something that was not broken. Check `xcrun --find simctl` instead.

**When someone does run it, do not press the final delete.** There is one real
account and no throwaway. Verify the screen renders, the button stays disabled
until the phrase is typed, and stop there — item D already proved the cascade
against a disposable account on 1 Aug.

## Environment gaps that are not code

- `MOBILE_TEST_TOKEN` in `.env` **expired 02:58 UTC 2 Aug**. Three bearer checks
  in `verify-mobile-contract` fail against any target until it is refreshed off
  the simulator.
- `CONSULTANT_HEALTH_SECRET` is not set on prod, so `/api/health/consultant`
  returns 503 there and the canary cannot check prod. The candidate has it.

---
---

# Handoff — 2 Aug 2026, ~08:00 (morning session, superseded)

Written at the end of the morning session. **Superseded by the entry above** —
its "what I would pick up first" list is spent. Kept because its gotchas and its
production verification still hold.

## Where things stand

- **Production is live and verified.** `crewchief-demo.davidmasterson.co` serves
  `16c5d752`, the `demo-live` merge commit. It promotes `main` at `17b932e9`.
  `main` and `demo-live` are both pushed; working tree clean.
- **Branch `design/live-site-audit`** is merged into `main` and pushed. It can be
  deleted whenever; nothing depends on it.
- 57 suites, 978 tests, green. `npm run typecheck` clean.

## Confirmed on production, not assumed

Each of these was checked against the live domain after the promote finished,
because a green local build has been wrong before:

- `og:image` is `https://crewchief-demo.davidmasterson.co/opengraph-image`,
  returns `200 image/png`. **The share card works for the first time.**
- Zero occurrences of `localhost` in the deployed HTML.
- `/dark-roomb.jpeg` and `/garage-interior-1920.jpg` both 404 — the
  unprovenanced photography is gone from the site, not just from the repo.
- `/vehicles/wrx/hero-3x2.avif` serves 200 at 285 KB, against 861 KB of JPEG.
- `verify-demo.mjs` passes against prod (2 pre-existing warnings, unrelated).

## What changed in the tooling

- **New devDependency: `sharp`.** Only needed to regenerate derivatives —
  outputs are committed and Netlify never runs it. `npm run build:images`
  (add `--force` to rebuild everything).
- **Generated file:** `packages/core/src/vehicle-blur.ts`. Do not hand-edit; it
  is rewritten by the script above.
- **New tests:** `image-weight-budget.test.ts`, `reduced-motion.test.ts`. Both
  are static analysis, so both are registered in
  `tests-test-real-code.test.ts`'s `STATIC_ANALYSIS_SUITES` — a new suite that
  imports nothing will fail until it is registered *with a justification*.
- **New promote-gate step:** the share card check, between the version check and
  the demo contract.

## Gotchas worth knowing before you edit

1. **The promote gate's share-card check tests the candidate's origin, not the
   URL in the tag.** `metadataBase` is the production literal, so a candidate
   correctly advertises the prod domain; fetching that would test the build you
   are replacing. The first run of this gate failed for exactly that reason —
   a red check describing prod while the candidate was fine. If you change
   `metadataBase`, re-read that block.
2. **`.service-bay` and `.cockpit-belt` are single-element background stacks on
   purpose.** They go on containers that already have children, so every layer
   has to composite *underneath* content. A pseudo-element or child overlay will
   paint on top of the card. `.photo-plate` gets away with it only because its
   children are positioned.
3. **`repeat` vs `repeat-x` on a banded background layer.** `repeat` tiles
   vertically too, so the beltline's brushed grain climbed out of its 11% band
   and textured the whole page. Caught visually, not by a test.
4. **React 18.2 has no `fetchPriority` prop.** It is spelled lowercase and cast
   in `VehicleIdentity`. React 19 adds the camelCase one — switching early
   silently stops it being emitted.
5. **`NEXT_PUBLIC_SITE_URL` is optional and should stay unset in production.**
   The fallback is the real domain, so unset degrades to *correct for prod*. Set
   it on deploy previews so a preview's card stops claiming to be the live site.

## What I would pick up first, in order

1. **Item 10 (`DEMO_IMAGES`)** — the only open item that is a live hazard rather
   than new work, and the only one blocked purely on information. Query the live
   database for what the three demo `image_url` values actually are. If they are
   the local hero paths, the migration has been applied and the map can be
   retired once the card has a card-sized source.
2. **Item 17's contrast finding** — `white/30` and `white/40` body text fails
   WCAG AA (2.71:1 and 3.78:1). App-wide tokens, so it is a Design call, but it
   is a real accessibility defect on a portfolio piece and it is cheap to fix.
3. **Commit `photography/build_assets.py`** if it exists on the machine. Until
   then the demo derivatives are not reproducible and the crop anchors live only
   inside the JPEGs.
4. **Item 13's second half** — the DS/`tokens.json` promotion, so the React
   Native build inherits the cockpit language instead of re-deriving it.
5. **Item 15's LCP/CLS**, if someone will own the flake budget.

## Rollback, if the demo looks wrong

Revert the merge commit on `demo-live` and push. The demo returns to its
previous build without touching `main`:

```
git checkout demo-live && git revert -m 1 16c5d752 && git push origin demo-live
```

If the site looks stale rather than wrong, check for cached CSS/JS before
suspecting the code — that has been the answer more than once here.
