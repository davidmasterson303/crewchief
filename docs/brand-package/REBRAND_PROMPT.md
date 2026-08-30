# Rebrand: CrewChief → Well Kept

Prompt for Claude Code. Maker is **Southmoor Digital LLC**. App Store name **Well Kept: Know Your Car**, subtitle **AI-kept service records**. Revenue is Apple IAP, monthly + annual.

The rebrand is a **name and a mark**. No token moves, no palette change, no type change. If a diff touches `tokens/colors.css` values, surfaces, dials, band thresholds or provenance wording, it is out of scope — revert it.

## 1. String table

| What | Was | Is |
|---|---|---|
| Product name | CrewChief | Well Kept |
| Store name · subtitle | CrewChief | Well Kept: Know Your Car · AI-kept service records |
| Maker / seller | David Masterson | Southmoor Digital LLC |
| Bundle id | `co.davidmasterson.crewchief` | `co.southmoordigital.wellkept` |
| Shared package | `@crewchief/core` | `@wellkept/core` |
| Design system | CrewChief Design System v8 | Well Kept Design System v9 |
| Repo | `davidmasterson303/crewchief` | rename, or keep and note it |

**Ruling: keep `co.davidmasterson.crewchief`.** A bundle-id change is a new App Store record, not an update to a live one, and no user ever sees the id. Change the display name only. The id, the repo name and `@crewchief/core` are cosmetic and stay until there is an unrelated reason to touch them — a rebrand is not worth losing a listing's history over. `@wellkept/core` in the design system's citations is the *intended* name, not a required rename this pass.

## 2. The mark

A backlit coachbuilder's plate. Drawn on a **280 × 116** grid; the square icon form uses **100 × 100**.

```
plate    M16 8 H264 L272 24 V92 L264 108 H16 L8 92 V24 Z     fill #16140F
edge     stroke rgb(160 240 252 / 0.55), width 2
glow     the same path, filled #22D3EE, blur 10, opacity 0.55, behind the plate
rivets   r 2.5 at (30,22) (250,22) (30,94) (250,94), fill rgb(245 243 240 / 0.3)
name     "Well Kept", Newsreader 500, 38px, small caps, tracking 0.1em, #F5F3F0, centred at y 63
maker    "SOUTHMOOR DIGITAL", Inter 600, 13px, tracking 0.18em, rgb(245 243 240 / 0.5), y 92

icon     M22 12 H78 L88 26 V74 L78 88 H22 L12 74 V26 Z
```

Rules:

- **The name never glows. The plate does.** If the letters light, the plate reads as a button.
- Clear space: **48 grid units** on all sides. Nothing enters it, including the score mark.
- Minimum sizes: full lockup 240px wide (below that the maker line breaks the 12px text floor and must be dropped); short lockup 160px; under 160px use the icon.
- On light grounds the glow cannot exist: plate `fill: none`, edge `#0E7490` at width 3, name `#100F0D`. This is the only sanctioned substitution.
- Never fill the plate with cyan, never recolour it to a semantic family, never stretch it, never place it on a photograph without a scrim.

## 3. App icon set

One drawing, three reductions. Ground is baked in (iOS does not composite transparency).

| Sizes | Drawing |
|---|---|
| 1024, 180, 167, 152, 120 | full: glow + plate + edge + `WK`; rivets only at ≥120 |
| 87, 80, 76, 60 | drop the K — single `W` |
| 58, 40 | drop the glow; solid `#A0F0FC` edge |
| 29 | invert: solid `#F5F3F0` plate, knocked-out `W` |

No intermediate drawings, no hinting. Each tile takes the largest reduction whose floor it clears.

## 4. Code changes, by surface

1. **Nav / header lockup** — one component, `<BrandLockup size mono />`. Replaces the truck glyph + 17px semibold "CrewChief" with the 28px plate mark + Newsreader small caps 19–20px. Sites: web garage nav, onboarding screen 1, launch screen, paywall, empty states.
2. **Retire the car glyph — in the design-system templates, not the build.** Correction on this document's first pass: there is no truck glyph in the app. The nav ships the Sweep dial mark, and it is the templates that carry the car icon. So: replace the dial mark in the nav with the plate lockup, and drop the car icon from the template chrome. The car icon survives where it means *a car* — the consultant composer's vehicle-context line.
3. **`app.json`** — `name`, `slug`, `ios.bundleIdentifier`, icon set, splash. Portrait, dark, no iPad: unchanged.
4. **Strings** — grep `CrewChief` / `crewchief` case-insensitively across app, mobile, docs, tests and store metadata. Expect hits in `SignInScreen`, onboarding copy, email templates and `README`.
5. **Paywall** — new screen. Annual preselected, saving stated as a figure, CTA names the price, "Not now" always reachable.

   **Gates: AI consultant, invoice scanning, second vehicle, factory build specs, full history.**

   **Recalls are free, and `paid-features.ts` is right.** The first pass of this document gated them; that was wrong and the shipped argument is the correct one — a federal defect notice an owner cannot see because their card expired is not a version of this product that should exist. It is also the one item on the list that is not ours to sell: NHTSA publishes it. Keep the test that asserts it. Free tier: one car, its health score, **its recalls**, and a manual service log.
6. **Paywall triggers** — second car, first scan, first consultant question. **Never on first run**; onboarding ends in a working garage.

## 5. Voice

"An AI that keeps the record, so the care keeps itself."

The AI is a **method, not a personality**. No "AI-powered", no "smart", no "effortless", never first person for the AI. It says what it read and what it concluded; the provenance line carries the receipt. Existing voice rules are inherited unchanged — plain, declarative, no exclamation points, no emoji.

## 6. Design files in this project

- `Well Kept Brand.dc.html` — identity spec: lockups, construction, clear space, icon set, voice, rename diff
- `Well Kept Store.dc.html` — store listing and paywall
- `Well Kept Landing.dc.html` — marketing site
- `Well Kept Onboarding.dc.html` — first run, rebranded from the template
- `Well Kept Garage.dc.html` — signed-in home, rebranded nav
- `Well Kept Logo Directions.dc.html` — the exploration; **3b** is the chosen mark

Vehicle detail, consultant and maintenance history carry no brand string — the only change there is the nav lockup, once the component above exists.

## 7. Answers to `design-system-drift.md` §7

**The two lockup SVGs are replaced, not edited.** Both currently draw "CrewChief" as vector outlines, so there is no string to change — delete them and reference `lockup-full.svg` / `lockup-short.svg` from the brand package. Outlined type is also why the rename cannot be a find-and-replace: grep will report those files clean.

**The wordmark tracking is restored to 0.1em and is not optical.** It was cut to fit one nine-letter word; "Well Kept" is nine characters including the space and sets at 0.1em small caps without touching the plate's inner step. A plate carries engraved type — the letterspacing is the engraving, and it does not get tuned per word. If a longer string ever has to fit, the plate widens; the tracking does not close.

**Tagline and subtitle homes, now that Design has them:**

| String | Where |
|---|---|
| `An AI that keeps the record, so the care keeps itself.` | landing hero h1; store screenshot 1 |
| `Well Kept: Know Your Car` | `app/layout.tsx` `metadata.title`; App Store name |
| `AI-kept service records` | `app/layout.tsx` `metadata.description` lead; App Store subtitle |
| `Read the paperwork. Keep the record.` | paywall h1 |
| `Every invoice read, every interval anchored.` | empty states, push copy |

**The type is outlined in the export, not at runtime.** See the package README: every SVG declares `Newsreader, Georgia, serif`, which is correct in a browser and wrong in a rasteriser that does not have the webfont. Convert `<text>` to paths when the PNG set is generated.

## 8. Build sequencing

**The iOS display name and the icon set both need a native EAS build** — Metro will not move either, so they cannot ride an OTA update. Bundle them into one build with anything else native that is queued rather than spending a build on the name and a second on the icons. Everything else in this document (strings, lockup component, paywall, landing, metadata) is JS and ships over the air.

## 9. Open

- Prices are placeholders ($4.99 / $39.99). Confirm before store metadata.
- `wellkept.app` or similar domain not checked.
- Trademark clearance on "Well Kept" in class 9 / 42 is not done.
