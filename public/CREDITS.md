# Site imagery — sourcing record

Vehicle photography is documented separately and thoroughly in
[`vehicles/CREDITS.md`](vehicles/CREDITS.md). This file covers everything else in `public/`,
which until now was nothing — and that was the problem.

---

## `dark-roomb.jpeg` → `garage-interior-1920.jpg`

The garage interior behind the demo garage grid on `/`.

| | |
|---|---|
| Photographer | **unknown** |
| Source URL | **unknown** |
| Licence | **unverified** — believed Unsplash |
| Native | 3333 × 2000 |
| Served | `garage-interior-1920.jpg`, 1920 wide, ~142 KB |

### ⚠ This one needs David, and it is the only asset on the site in this state

The sole record of where this image came from is a code comment in `app/page.tsx`:
"Self-hosted (was hot-linked from Unsplash — a third-party outage or rate limit would grey
out the landing visual)." Self-hosting it was the right call. What did not happen alongside
it was writing down which image it is.

EXIF carries no copyright, author or creator field — the file has been stripped or
re-encoded — so the provenance cannot be recovered from the file itself.

**Why "believed Unsplash" is not good enough.** The Unsplash licence is permissive and would
almost certainly cover this use. But since 2021 Unsplash also serves **Unsplash+**, which is
a paid licence with different terms, and the two are indistinguishable once an image is
downloaded and its metadata stripped. Without the source URL there is no way to tell which
licence applies, and "it was probably fine" is not a licence.

Every other image on this site can be traced to a photographer and a URL. This one cannot.

**To close it,** find the original — likely in browser history or downloads around the date
the hot-link was replaced — and fill in the three unknown rows above. If it cannot be found,
replace the image rather than keep it: a background plate is cheap to re-source, and the
alternative is shipping one undocumented asset on a portfolio piece whose whole point is
that the work is careful.

### Derivative

`garage-interior-1920.jpg` is `dark-roomb.jpeg` resized to 1920 wide and re-encoded at
quality 72 — 480 KB to 142 KB, for a plate that is displayed at viewport width behind a
scrim. The 3333 × 2000 master was roughly three times the pixels any viewport asked for.

```
sips -Z 1920 -s format jpeg -s formatOptions 72 public/dark-roomb.jpeg \
  --out public/garage-interior-1920.jpg
```

The master is kept, per the convention `vehicles/CREDITS.md` sets: derived files are
reproducible from masters, never hand-edited.
