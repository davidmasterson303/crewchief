# Well Kept — brand package

Chosen mark: **3b, the backlit coachbuilder plate**. Direction board: `Well Kept Logo Directions.dc.html` (turn 3).

## Contents

| File | Use |
|---|---|
| `lockup-full.svg` | Full lockup with maker line. Store, paywall, launch screen, foot of a service record. Min width 240px. |
| `lockup-short.svg` | No maker line. Nav, footers, anywhere the maker is already stated. Min width 160px. |
| `lockup-light.svg` | Light grounds. Glow cannot exist, so cyan-700 becomes the plate edge. |
| `icon-a-full-1024.svg` | App icon, 1024 / 180 / 167 / 152 / 120. |
| `icon-b-single-w.svg` | App icon, 87 / 80 / 76 / 60 — K dropped. |
| `icon-c-flat-w.svg` | App icon, 58 / 40 — glow dropped. |
| `icon-d-inverted-29.svg` | App icon, 29 — solid plate, knocked-out W. |
| `favicon-mono.svg` | Favicon and tab bar. Takes `currentColor`. |
| `REBRAND_PROMPT.md` | The full handoff: string table, geometry, per-surface changes, voice. |

## Two things to do before these ship

**1. Outline the type.** Every file sets `font-family="Newsreader, Georgia, serif"`. That is correct in a browser with the webfont loaded and wrong everywhere else — a rasteriser without Newsreader silently substitutes Georgia and the W changes shape. Convert the `<text>` elements to paths in the export step, then the PNGs are font-independent.

**2. Bake the ground.** The icon files carry their own background because iOS does not composite transparency on the home screen. Do not export them with a transparent ground.

## Export set

1024, 180, 167, 152, 120, 87, 80, 76, 60, 58, 40, 29. Each size takes the largest reduction whose floor it clears — no intermediate drawings, no hinting.
