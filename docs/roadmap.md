# CrewChief roadmap — image pipeline, backdrop, and cockpit direction

Source: `Live-Site Audit.dc.html` (2 Aug 2026), grounded in repo `davidmasterson303/crewchief@main` (aa1d73f) and the live demo. Finding refs (F1–F8) and concept refs (1a–1c, 2a–2c) point into that report. Advisor KB was offline for the audit; reconcile against it when reconnected, and stage a `kb_propose` for the decisions below.

---

## P0 — this week (portfolio-share and sign-up paths)

### 1. Fix the social preview image (F1)
- **Problem:** `app/layout.tsx` sets `openGraph.images` as a relative URL with no `metadataBase`, so deployed HTML resolves it to `http://localhost:3000/garage-interior-1920.jpg`. Every share card from the portfolio link renders blank.
- **Change:** add `metadataBase: new URL('https://crewchief-demo.davidmasterson.co')` to the metadata export in `app/layout.tsx`.
- **Verify:** view-source on the deployed page — `og:image` must be an absolute production URL; re-scrape with a link-preview debugger.
- **Effort:** one line.

### 2. Stop auth pages fetching the 480 KB master (F2)
- **Problem:** login (`:131`), signup (`:110, :172, :194`), forgot-password (`:46, :75`), reset-password (`:109`) all background `dark-roomb.jpeg` (3333×2000, 480 KB) behind a 60–85% black scrim. The 142 KB 1920-wide derivative already exists.
- **Change (interim):** point all seven refs at `/garage-interior-1920.jpg`.
- **Change (real):** these pages take the CSS plate (item 3) and stop shipping a photo at all.
- **Effort:** minutes.

### 3. Replace the backdrop with a built environment; delete the unprovenanced photo (§02)
- **Problem:** the garage backdrop is the site's only asset with unknown provenance — photographer unknown, source unknown, EXIF stripped, "believed Unsplash" (indistinguishable from paid Unsplash+ post-download). `public/CREDITS.md`'s own recommendation is replace, not re-trace. It's also disliked aesthetically and is the main pop-in offender (F4).
- **Change:** ship concept **1a "Service bay"** as the backdrop on `/` — a CSS-built environment (graphite gradient base, one cyan LED batten with radial wash, wall/floor horizon hairline, sealed-concrete floor band with faint cyan reflection, faint wall-panel seams, vignette). Auth pages get a dimmed variant: LED wash at ~40%, deeper vignette — one variable.
- **Then:** delete `public/dark-roomb.jpeg` and `public/garage-interior-1920.jpg`; close the open item in `public/CREDITS.md` with "replaced by a built environment — no licence to record." Hold concept **1c "Cockpit ambient"** (brushed beltline + ambient strip) for the dashboard in P3 so the two screens rhyme.
- **Why CSS, not another photo:** 0 KB vs 142–480 KB per page; no licence ever; paints with the stylesheet (F4 dissolves); crisp at every viewport/DPR; tunable per surface.
- **Effort:** about half a day including deletion + CREDITS.

---

## P1 — next

### 4. Modern formats and sizes for all photography (F3)
- **Problem:** `next.config.js` sets `images: { unoptimized: true }`, nothing uses `next/image`, every photo is a fixed-size JPEG. Vehicle heroes run 660–950 KB (WRX portrait 948 KB).
- **Change:** extend `photography/build_assets.py` (already regenerates all derivatives from masters) to emit AVIF + WebP beside each JPEG; swap call sites to `<picture>` with JPEG fallback. Expect ≥50% weight reduction at equal quality.
- **Alternative:** verify the Netlify runtime version — if Runtime v5+, `next/image` is wired to Netlify Image CDN and the `unoptimized` flag may simply predate that; removing it could replace the manual pipeline. Check before building.
- **Effort:** ~1 day.

### 5. Preload any surviving LCP photo (F4 residue)
- **Change:** for any page that still carries a photographic backdrop or hero, add `<link rel="preload" as="image">` in the head (background-image in a client component is otherwise discovered post-hydration).
- **Effort:** ~1 hour.

### 6. Delete the Google image-search pipeline (F5)
- **Problem:** `lib/vehicle-images.ts` hotlinks whatever Google Custom Search returns for user vehicles — third-party images with no licence, from URLs that rot. The search key expired 28 Jul, so it already returns nothing; its Unsplash fallback URL 404'd in production (documented in the file's own comments).
- **Change:** remove the pipeline and its env keys. Owner upload (which already downscales client-side with EXIF orientation handled) plus the make-derived identity plate covers every case with zero third-party risk. `VehicleIdentity`'s docblock already declares the plate "the primary design, not the fallback."
- **Effort:** ~1 hour.

### 7. Cluster gauge replaces the donut (2a)
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
- Signed-URL resolution collapses pending → "no photo," so the identity plate renders first and the photograph replaces it in one frame. Add a 200ms opacity fade on image load. Nothing else — layout stability is already right. (~1 hour)

### 9. Ambient hairline + machined wells + ignition sweep (2b, 2c, motion spec)
- **2b:** the nav's bottom edge carries a single 1px luminous cyan hairline (gradient fading at both ends, soft 10px glow) — the one place glow lives on chrome; one per screen, same discipline as the serif rule.
- **2c:** stat wells take a machined top edge — 1px catch-light + ~30px gradient falloff over `--surface-3`; everything else stays matte; no glassmorphism, no new tokens.
- **Ignition sweep:** on dashboard load, once per session — needle sweeps 0 → 100 → settles on the score in ~900ms (ease-out return), arc draws in behind it, count-up in sync. Complements the scan line (scan = photo band, sweep = gauge; never both on one element). `prefers-reduced-motion` jumps to the settled state. Hooks exist in `use-count-up.ts` and the intro gate. (~half day total)

### 10. DEMO_IMAGES + migration deleted together (F8)
- The `DEMO_IMAGES` override in `VehicleCard.tsx` and migration `20260726230000` must ship their deletions as one ticket — dropping the override first sends demo cards back to the Pexels CDN URLs still in the database. (bookkeeping)

### 11. Blur-layer derivative (F7, optional)
- `VehicleIdentity` decodes the same source twice (blur fill + sharp contain). Acceptable once P1 item 4 lands; optionally feed the blur layer a tiny (~64px) derivative. Fully closed by P4 item 15.

---

## P3 — next quarter: system coherence

### 12. Own the vehicle photography
- One commissioned session for the three demo cars. Fixes both documented content errors — the Accord is an 8th-generation car standing in for the seeded 2018 tenth-gen Sport 2.0T (and its hard-orange sunset violates the photography spec), and the "M3" may be an F30 with M-Sport package rather than an F80 — and clears the trademark caveat (recognisable marques in store marketing) blocking App Store captures. Full assignment of rights; masters into `photography/masters/`, derivatives regenerated via `build_assets.py`, provenance recorded in `public/vehicles/CREDITS.md` as with the Pexels set.
- Fallback if a shoot doesn't happen: re-source correct-generation cars via the existing Pexels workflow (photographer + URL recorded before the file enters the repo; dark/neutral light, no people, no plates, no signage) — but the trademark caveat then still needs a decision before store assets.

### 13. Make garage and dashboard rhyme
- Dashboard adopts the **1c** beltline backdrop (brushed-metal band + one ambient strip) so the public garage (1a) and the dashboard share one environmental language.
- The cluster kit — dial (2a), band scale with 40/60/80 ticks, ignition sweep — is promoted into the design system as real components and into `tokens.json`, so the React Native build inherits the cockpit language rather than re-deriving it. Update the DS specs that still describe the donut.

### 14. Onboarding template
- The design system's own flagged gap: no template exists for onboarding (or invoice scan, or maintenance history). Onboarding is the first screen a paying user meets and the last one still designed ad hoc — build it from the same tokens before the App Store push, with the cluster/plate language applied from the start.

---

## P4 — pre-launch: hardening & proof

### 15. Budgets in CI, not vigilance
- LCP and CLS thresholds plus a per-page image-weight budget, checked on every Netlify deploy preview (Lighthouse CI or equivalent), so an F2/F3-class regression can never ship silently again. The promote gate already exists and already reads build-time env — give it these numbers as a second criterion.

### 16. Finish the media pipeline
- `srcset` breakpoints for the card/detail/hero slots; `fetchpriority="high"` on the LCP image per page; a tiny inline (~64px, base64) blur-up derivative feeding `VehicleIdentity`'s fill layer — instant paint under the sharp copy, and F7's double decode of the full-size file is gone.

### 17. Accessibility pass on the new visuals
- Contrast audit of text over the plates at their dimmest (auth variant) against WCAG AA;
- `prefers-reduced-motion` coverage verified across door intro, scan line, and ignition sweep as one audited list rather than per-feature memory;
- forced-colors / high-contrast mode on the gauge (ticks, needle, and band label must survive without color).

### 18. Store-capture production run
- Marketing screenshots produced from the owned P3 photography, with the photography spec enforced (no sunset frames — the rule the current Accord breaks), plate-blur boxes applied, and the trademark posture decided and recorded. Captures reproducible from a script, same convention as `build_assets.py`.

---

## Sequencing logic
P0 removes the two user-visible embarrassments on the highest-traffic paths and retires the licence risk. P1 makes every remaining image cheap and kills the unlicensed acquisition path. P2 is polish that needs P1's pieces. P3 spends real money (photography) only after the system it feeds is coherent. P4 locks the results in with automated proof before the App Store push.
