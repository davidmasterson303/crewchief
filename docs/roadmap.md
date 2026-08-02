# CrewChief roadmap — image pipeline, backdrop, and cockpit direction

Source: `Live-Site Audit.dc.html` (2 Aug 2026), grounded in repo `davidmasterson303/crewchief@main` (aa1d73f) and the live demo. Finding refs (F1–F8) and concept refs (1a–1c, 2a–2c) point into that report. Advisor KB was offline for the audit; reconcile against it when reconnected, and stage a `kb_propose` for the decisions below.

---

## Status — 2 Aug 2026, morning session

**Live on production.** `crewchief-demo.davidmasterson.co` is serving `16c5d752`
(the `demo-live` merge), promoted from `main` at `17b932e9` through
`scripts/promote-demo.mjs`. All gate checks passed; `verify-demo.mjs` green
against prod afterwards.

| | Items | |
|---|---|---|
| **Done** | 1, 2, 3, 4, 6, 7, 8, 9, 11, 16, 17 | 11 |
| **Partial** | 13, 15 | 2 |
| **Open** | 5, 10, 12, 14, 18 | 5 |

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
> **OPEN — deliberately not done, and the item's premise is inverted.**
>
> Migration `20260726230000` sets `image_url` to **local** paths
> (`/vehicles/accord/hero-3x2.jpg` and siblings). It is what *removes* the Pexels URLs, so
> reverting it would restore them, not clear them.
>
> The real hazard is the one `VehicleCard`'s own comment names: the map points cards at
> `card-800` derivatives while the column holds the page-width hero, so deleting it makes
> the grid fall back to three heroes — the payload the map exists to prevent, and a
> straight failure of the budget test.
>
> **To close it properly:** check what the live database actually holds (not what the
> migration file says), then give the card a card-sized source — a second column, a naming
> convention, or `srcset` — and delete the map in the same change.

- The `DEMO_IMAGES` override in `VehicleCard.tsx` and migration `20260726230000` must ship their deletions as one ticket — dropping the override first sends demo cards back to the Pexels CDN URLs still in the database. (bookkeeping)

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

# Handoff — 2 Aug 2026, ~08:00

Written at the end of the morning session. Read this before touching anything.

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
