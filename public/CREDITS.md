# Site imagery — sourcing record

Vehicle photography is documented separately and thoroughly in
[`vehicles/CREDITS.md`](vehicles/CREDITS.md). This file covers everything else in `public/`,
which is now nothing at all — and that is deliberate.

---

## `dark-roomb.jpeg` → `garage-interior-1920.jpg` — removed 2 Aug 2026

**Status: closed. Replaced by a built environment — no licence to record.**

The garage interior behind `/` and the five auth screens. Neither file is in the repo any
more, and nothing took their place in `public/`: the room is drawn in CSS, by `.service-bay`
in `app/globals.css`, and the share card is generated at build time by
`app/opengraph-image.tsx`.

### What the open item was

| | |
|---|---|
| Photographer | **never established** |
| Source URL | **never established** |
| Licence | **never established** — "believed Unsplash" |
| Native | 3333 × 2000 |
| Served | `garage-interior-1920.jpg`, 1920 wide, ~142 KB |

The sole record of where the image came from was a code comment in `app/page.tsx`:
"Self-hosted (was hot-linked from Unsplash — a third-party outage or rate limit would grey
out the landing visual)." Self-hosting it was the right call. What did not happen alongside
it was writing down which image it was.

EXIF carried no copyright, author or creator field — the file had been stripped or
re-encoded — so the provenance could not be recovered from the file itself.

**Why "believed Unsplash" was not good enough.** The Unsplash licence is permissive and would
almost certainly have covered this use. But since 2021 Unsplash also serves **Unsplash+**,
which is a paid licence with different terms, and the two are indistinguishable once an image
is downloaded and its metadata stripped. Without the source URL there was no way to tell which
licence applied, and "it was probably fine" is not a licence.

Every other image on this site could be traced to a photographer and a URL. This one could
not — and it was the first thing a visitor arriving from David's portfolio saw.

### Why it was replaced rather than traced

The previous revision of this file set out the choice: find the original, or replace it.
Replacing it won on three counts at once, only one of which was the licence.

- **Licence.** Nothing to trace, because there is nothing to license. The question cannot
  recur — which tracing would not have guaranteed, since a recovered URL still leaves
  Unsplash vs Unsplash+ to adjudicate.
- **Weight.** The auth screens fetched the 480 KB master — not even the 142 KB derivative
  `/` used — and then buried it under a scrim at 0.6 → 0.85 alpha. Roughly a tenth of it did
  any visual work. The CSS plate is 0 bytes on every surface.
- **Timing.** It was a `background-image` in an inline style on a client component, so the
  fetch could not begin until hydration; on a door-skip visit the room visibly arrived late.
  A gradient paints with the first stylesheet.

The aesthetic argument ran the same way — David did not like the photograph — but the three
above would have carried it regardless.

### If a photograph is ever wanted here again

Re-source it through the workflow `vehicles/CREDITS.md` already proves out: photographer and
source URL recorded **before** the file enters the repo, no exceptions. Art direction that
suits this product: dark working shop, cool or neutral light, no people, no visible plates,
and no brand signage — that last is a trademark question rather than a copyright one, and it
is the open caveat on the vehicle photographs. Top third calm enough to carry a headline,
≥2400px landscape.

For anything that must be owned outright — App Store marketing captures being the likely
case — commission it with a full assignment of rights, or use a generator whose terms are
written for commercial use and indemnify the customer.
