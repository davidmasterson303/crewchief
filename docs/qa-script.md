# CrewChief — QA script and report format

For an agent or a person testing the live demo. Written 2 Aug 2026 against
`demo-live @ e729ee96` (promoted from `main @ d3aae46`).

**Read §0 and §6 before you start.** §0 tells you what is already known to be
broken, and re-reporting it costs everyone a review cycle. §6 is the format the
report has to come back in — a finding without a measured value and a
`file:line` cannot be actioned, only re-investigated.

- **Target:** https://crewchief-demo.davidmasterson.co
- **Candidate (builds `main` first):** https://effulgent-blancmange-6adfdf.netlify.app
- **Confirm what you are testing:** `curl -s <target>/api/version`
  Prod must report `e729ee96` on branch `demo-live`. If it reports something
  else, say so in the report header — the expected values below are pinned to
  that build.

---

## 0. Known open — do NOT report these as new findings

All of these are already tracked in `docs/roadmap.md`. Report them only if the
behaviour is **worse** than described, or if you have a concrete fix.

### Responsive findings still open (Work stream B)

`R4, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15` — eleven of the audit's
fifteen. The ones you will notice first while testing:

| ID | What you will see | Where |
|---|---|---|
| R4 | Consultant is a fixed 520px box inside a scrolling page | `/consultant/*` |
| R6 | Four nested containers each take 24px a side; 375px yields ~199px of content | everywhere |
| R9 | Tab links ~36px tall, under the 44px floor | dashboard nav |
| R10 | ~30 uses of 10–11px type carrying real data | maintenance, chat, tables |
| R13 | Maintenance/cost tables cramped below `sm` | `/documents/*` |
| R15 | **640–767px renders one enormous column** — the worst width in the product | `/`, `/garage` |

R7 is folded into roadmap item 14 (onboarding template), not a separate ticket.

### Stream A still open

- **Item 5** — LCP preload. Cannot be done as written: the dashboard hero's URL
  comes from a client query plus a signed-URL exchange, so it is not knowable at
  HTML time. `fetchpriority` and the blur-up shipped instead.
- **Item 12 / 18** — vehicle photography and store captures. Needs a shoot.
- **Item 14** — onboarding template. Needs design.
- **Item 13 (partial)** — DS + `tokens.json` promotion outstanding.
- **Item 15 (partial)** — LCP/CLS in CI outstanding; image-weight budgets shipped.

### Known environment gaps, not code bugs

- `MOBILE_TEST_TOKEN` in `.env` **expired 02:58 UTC 2 Aug**. `verify-mobile-contract`
  will fail 3 bearer checks against any target until it is refreshed. The
  anonymous and demo paths still pass and are meaningful.
- `CONSULTANT_HEALTH_SECRET` is **not set on prod**, so
  `/api/health/consultant` returns 503 there and the canary cannot check prod.
  The candidate has it.
- `/dev/*` routes (e.g. `/dev/card-states`) **404 on prod** by design. Use the
  candidate or a local dev server for those.

### Documented content issues, deliberately unfixed

Recorded in `public/vehicles/CREDITS.md`: the Accord is an 8th-gen standing in
for a 2018 tenth-gen and its frame is a hard-orange sunset (violates the
photography spec); the "M3" may be an F30 with M-Sport rather than an F80; the
WRX is a VB standing in for a 2020. The **BMW M3 has no photograph on purpose** —
it is the only live exercise of the no-photo identity plate. A card or hero
showing the plate for the M3 is correct behaviour, not a broken image.

---

## 1. Automated suites — run these first

From a clone at the commit under test:

```bash
npx tsc --noEmit
npx jest --silent
node scripts/verify-demo.mjs https://crewchief-demo.davidmasterson.co
node scripts/verify-mobile-contract.mjs https://crewchief-demo.davidmasterson.co
```

Expected at `e729ee96`: typecheck clean; **57 suites / 979 tests** pass;
verify-demo "Demo is serving correctly" with 2 warnings;
verify-mobile-contract **FAILS 3 bearer checks** for the expired-token reason in
§0 — everything else in it passes.

If the jest count differs from 979, say so in the header. A changed count means
the tree is not the tree these numbers were taken from.

---

## 2. Viewport matrix

Six widths from the audit, plus one the audit's own list misses. Test **every
route at every width** — the failures cluster at the two ends and in the 640–767
band.

| Width | Why this one |
|---|---|
| **320** | Smallest realistic device (SE 1st gen). Nothing may overflow. |
| **375** | iPhone SE/12 mini. The reference phone width. |
| **414** | Large phone. |
| **700** | **Added.** Inside R15's dead zone — measured live: the garage grid is a single 652px column with 650px cards. The audit's six widths step straight over this, because 768 already has `md:grid-cols-2` and looks fine. A landscape phone and a small tablet both land here. |
| **768** | Tablet portrait. `md` applies, so this is *not* the broken width — useful as the control against 700. |
| **1024** | `lg`. Sidebars and three-up grids appear here. |
| **1440** | Desktop reference. |

Optional: 1920 for wide-desktop gutters, and 375 **landscape** (812×375) — short
viewports are where `dvh` and fixed heights break.

### Routes

| Route | Anonymous? |
|---|---|
| `/` | yes |
| `/login`, `/signup`, `/forgot-password` | yes |
| `/dashboard/a2000000-0000-0000-0000-000000000002` | yes (demo) |
| `/vehicle-info/a2000000-0000-0000-0000-000000000002` | yes |
| `/consultant/a2000000-0000-0000-0000-000000000002` | yes |
| `/garage` | redirects anonymous → `/` |

Demo vehicle ids: WRX `a2000000-…0002`, Accord `a1000000-…0001`,
M3 (no photo) `a3000000-…0003`.

### The one check to run at every width

Paste this in the console on each route/width. It is the same probe each time,
so results are comparable between testers.

```js
(() => {
  const de = document.documentElement, v = innerWidth;
  const wide = [...document.querySelectorAll('*')]
    .filter(e => e.getBoundingClientRect().width > v + 1)
    .slice(0, 5)
    .map(e => e.tagName + '.' + String(e.className).slice(0, 50));
  const small = [...document.querySelectorAll('*')]
    .filter(e => e.childElementCount === 0 && e.textContent.trim())
    .map(e => parseFloat(getComputedStyle(e).fontSize))
    .filter(n => n && n < 12);
  const targets = [...document.querySelectorAll('button,a,[role="button"],input,select')]
    .filter(e => { const r = e.getBoundingClientRect();
      return r.width && r.height && (r.height < 44 || r.width < 44); });
  return {
    route: location.pathname, viewport: v,
    horizontalOverflow: de.scrollWidth > de.clientWidth,
    scrollWidth: de.scrollWidth,
    overflowOffenders: wide,
    textUnder12px: small.length,
    targetsUnder44px: targets.length,
    targetsSample: targets.slice(0, 5).map(e =>
      (e.textContent.trim().slice(0, 20) || e.tagName) + ' ' +
      Math.round(e.getBoundingClientRect().height) + 'px'),
  };
})()
```

### Measured baseline on `e729ee96` — diff against this, don't judge from scratch

Taken live on 2 Aug 2026. These are the *current, known* numbers. Report a
**delta**, not the absolute value.

| Route | Width | h-overflow | text <12px | targets <44px | note |
|---|---|---|---|---|---|
| `/` | 375 | false | 1 | 15 | |
| `/` | 700 | false | 1 | 15 | **R15: grid is one 652px column, cards 650px** |
| `/` | 768 | false | 1 | 15 | grid `346px 346px` — `md` applies, so 768 is *not* the bad width |
| `/dashboard/…0002` | 375 | false | 7 | 25 | **R9: tab links 36px** · R10 |
| `/vehicle-info/…0002` | 375 | false | — | — | R3 fixed: tiles 227px, one column |
| `/login` | 375 | false | — | — | 2 inputs, both covered by the R2 touch rule |
| `/signup` | 375 | false | — | — | 3 inputs |
| `/consultant/…0002` | 375 | false | — | — | composer carries no size utility |

Note R15's dead zone is **640–767**, not 768 — at 768 `md:grid-cols-2` kicks in
and the layout is fine. Test at 700 to see it.

`horizontalOverflow: true` is **always a bug** — report it. `textUnder12px` and
`targetsUnder44px` are R10 and R9, already open: report the **count per route**
as data, not as new findings.

---

## 3. Regression checks — these shipped, they must not break

Expected values are from the live `e729ee96` build. A mismatch is a real finding.

### Stream A

| # | Check | Expected |
|---|---|---|
| A1 | `curl -s <t>/ \| grep 'og:image"'` | absolute `https://crewchief-demo…/opengraph-image`, **never** `localhost` |
| A2 | `curl -sI <t>/opengraph-image` | `200`, `image/png` |
| A3 | `curl -sI <t>/dark-roomb.jpeg` and `/garage-interior-1920.jpg` | **404** both |
| A4 | `/vehicles/wrx/hero-3x2.avif` | `200`, ~285 KB |
| A5 | Grid on `/` — network panel | requests `card-800.avif` ×2, **no `hero-3x2`** |
| A6 | Dashboard band — network panel | requests `hero-3x2.avif`, **no `card-800`** |
| A7 | Gauge `<svg>` on dashboard | `viewBox="0 0 200 178"`, 21 ticks, majors labelled `0,20,40,60,80,100`, hub present |
| A8 | Gauge `aria-label` | `Health score N out of 100 — <band>` |
| A9 | Blur fill layer `background-image` | starts `url("data:image/webp` |
| A10 | Hero probe `<img>` | `fetchpriority="high"` |

A5 and A6 are the item-10 regression: the card must not fetch the page-width
hero. That is a ~10× payload difference and it is invisible on desktop wifi.

### Stream B (shipped: RB0, R1, R2, R3, R5)

| # | Check | Expected |
|---|---|---|
| B1 | **R2** — stylesheet contains `@media (hover: none) and (pointer: coarse)` with `font-size: 16px` on `.field, .field-sm, textarea, select, input[...]` | present |
| B2 | **R2** — any `<input>`/`<textarea>` carrying a real `text-xs/sm/base/lg` utility | **none** (`file:text-*` is a variant on `::file-selector-button` and is fine) |
| B3 | **R2** — with touch emulation on, focus each field | `visualViewport.scale` stays `1`; pinch-zoom still works |
| B4 | **R1** — open any dialog at 375×812 | width ~326px, ≥16px backdrop each side, `max-height` ≈ `690px` (85dvh), `overflow-y: auto`, radius 16px, title **and** submit both reachable |
| B5 | **R1** — grep the tree | **no** `max-h-[90vh]` / `max-h-[80vh]` on any `DialogContent` |
| B6 | **R3** — `/vehicle-info/*` spec tiles at 375 | one column, ~227px per tile |
| B7 | **R5** — emulate `hover: none` | card photo overlay, card ⋮ menu, maintenance delete all **visible and tappable** |
| B8 | **R5** — grep the tree | no `group-hover:opacity-100` / `group-hover/image:opacity-100` remaining |

**B3 and B7 are the two that need real emulation** and are the two most likely to
be skipped. DevTools → Rendering → *Emulate CSS media feature* for `hover`/
`pointer`; device toolbar with touch for B3. If you cannot emulate them, say
"not run" — do not infer them from the CSS being present.

### Accessibility

| # | Check | Expected |
|---|---|---|
| C1 | Emulate `forced-colors: active`, view dashboard gauge | track/arc/needle/ticks remain **distinguishable**; the arc must not read as a full ring at every score |
| C2 | Emulate `prefers-reduced-motion: reduce`, load dashboard | gauge lands on its score with no sweep; door intro skipped; TCO ring lands instantly; chat scroll jumps rather than smooth-scrolls |
| C3 | Contrast of body text on the plates | **known:** `white/50`+ passes AA (5.13:1); `white/40` = 3.78:1 and `white/30` = 2.71:1 **fail**. Reported, awaiting a Design decision on the tokens — report only *new* offenders |

---

## 4. Exploratory — where bugs are most likely

Ranked by where this codebase has actually broken before.

1. **Dialogs at 320 and at 375 landscape.** R1 was fixed in the primitive; ten
   dialogs inherit it and six had local overrides deleted. A short viewport
   (375×812 rotated → 812×375) is the case `dvh` exists for.
2. **The consultant at every width** — R4 is open, but check the composer
   specifically: it lost its `text-sm` for R2, so confirm nothing else regressed
   in that panel.
3. **Photo states.** Each vehicle in three states: has photo / no photo (M3) /
   photo 404s. The last is hardest — a broken image must **never** render; it
   must fall back to the identity plate.
4. **The garage grid at 640–767px** (R15, open) and at ≥1536 (fourth column).
5. **Long content** — a vehicle with many recalls, a long consultant transcript,
   a maintenance list past the fold.
6. **Slow network** (throttle to Fast 3G). The blur-up should paint immediately
   and the photograph fade in over it. Layout must not shift — CLS is the thing
   to watch.

---

## 5. Do not do these

- **Do not push to `main` or `demo-live`.** Report findings; promotion goes
  through `scripts/promote-demo.mjs` and a human.
- **Do not run `next build` while a dev server is running** — they share `.next`
  and the app serves 404s for chunks that exist. Use
  `NEXT_DIST_DIR=.next-verify npm run build`, and revert `tsconfig.json`
  afterwards (the build rewrites it).
- **Do not `git stash`.** Sessions share the index; commit with an explicit
  pathspec instead.
- **Do not edit `packages/core/src/vehicle-blur.ts`** — generated by
  `npm run build:images`.
- **Do not claim a DB fact from a migration file.** The live database and the
  migrations have drifted in both directions before. Query it.

---

## 6. Report format

One header block, then one block per finding. **A finding without a measured
value and a `file:line` will be sent back**, because it cannot be told apart
from a guess.

### Header

```
TARGET      https://crewchief-demo.davidmasterson.co
COMMIT      <what /api/version reported>   ← not what you expected it to be
DATE        <ISO>
SUITES      tsc <pass|fail> · jest <N passed / M total> · verify-demo <pass|fail>
            verify-mobile-contract <pass|fail — note expired-token failures separately>
WIDTHS      320 / 375 / 414 / 700 / 768 / 1024 / 1440   (mark any you skipped)
ROUTES      <list, mark any you skipped>
SUMMARY     <n> new · <n> regressions · <n> known-open confirmed
```

### Per finding

```
ID          NEW-01                     (NEW-nn, or the existing R-id / item number)
SEVERITY    CRITICAL | HIGH | MEDIUM | LOW
            CRITICAL = a screen is unusable, data is wrong, or something is
            unreachable. Not "looks cramped".
TYPE        regression | new | known-open-confirmed
ROUTE       /dashboard/a2000000-…
WIDTHS      the widths it reproduces at, and the widths it does NOT
FILE        components/Foo.tsx:214        ← required for anything in the repo
EXPECTED    <the value the spec or this document says>
OBSERVED    <the measured value — a number, not "too small">
REPRO       1. …  2. …  3. …
EVIDENCE    the exact command or console snippet you ran, and its raw output;
            screenshot filename if visual
CONFIDENCE  confirmed (I measured it) | plausible (looks wrong, not measured)
FIX         optional — a diff if you have one
```

### Rules for the report

1. **Measured, not adjectival.** "Tap target 36px against a 44px floor" — not
   "the tabs feel small".
2. **Separate regression from open.** A regression means it worked at
   `e729ee96` and does not now. Everything in §0 is `known-open-confirmed` and
   belongs in a single summary line, not one block each.
3. **Say what you did not run.** A skipped viewport or an un-emulated media
   feature is a gap in coverage, and a report that hides it is worse than one
   that admits it. `NOT RUN` is a valid result.
4. **Do not infer.** CSS being present in the stylesheet is not evidence that the
   rendered result is right — B3, B7, C1 and C2 all need the media feature
   actually emulated.
5. **One finding per block.** If a container fix would resolve five symptoms,
   file the container and list the symptoms inside it.
