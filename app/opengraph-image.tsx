/*
 * `next/server`, not `next/og`. Every current example writes `next/og` — that
 * path was added in Next 14, and this project is pinned to 13.5.11, where the
 * import resolves to nothing and the build fails with "Module not found".
 * Move it when Next is upgraded; the same note is on the Newsreader font in
 * layout.tsx, for the same pin.
 */
import { ImageResponse } from 'next/server';

import { BRAND_COLOR, BRAND_NAME, PLATE, RIVETS } from '@wellkept/core/brand';
import { isDemoSite } from '@/lib/site-role';

/*
 * The share card, generated rather than stored.
 *
 * The audit that prompted this found two faults on the same line of
 * `app/layout.tsx`: the card pointed at `/garage-interior-1920.jpg`, an image
 * whose licence public/CREDITS.md could not establish, and it pointed at it
 * *relatively* with no `metadataBase` — so Next 13.5 resolved it against
 * `http://localhost:3000` and every deployed share card asked scrapers to
 * fetch an image from their own machine. The portfolio link has been sharing
 * a broken preview.
 *
 * Deleting the photograph fixes the licence and breaks the card, so the card
 * needed a replacement first. This is it: the same service-bay recipe as
 * `.service-bay` in globals.css, rendered to PNG at build time. Nothing to
 * licence, no binary in the repo to drift from the stylesheet, and no fetch
 * of a 142 KB JPEG when a scraper comes calling.
 *
 * Next finds this file by convention — the filename is the API. It emits the
 * `og:image` and `twitter:image` tags itself, at the right absolute URL, which
 * is why `layout.tsx` no longer declares `images` at all. `metadataBase` still
 * has to be set there: convention-based routes are resolved against it too.
 *
 * Written with stacked absolute divs rather than the stylesheet's single
 * background-layer stack. This renders through Satori, not a browser, and
 * Satori takes a subset of CSS — no `background-size` per layer, no
 * `repeating-linear-gradient`. The values are the stylesheet's; keep them in
 * step by hand, there are only nine.
 *
 * The batten is drawn here even though `.service-bay` no longer carries one —
 * in the app it lives on the nav's bottom edge (`.bay-batten`), and a share
 * card has no nav to mount it to. So it is placed as the concept drew it, a
 * fixture below an implied ceiling. This is the one surface where the
 * original single-layer composition is still the right one.
 */

export const runtime = 'nodejs';
export const alt = 'Well Kept — an AI that keeps the record, so the care keeps itself';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          background: 'linear-gradient(180deg, #0B0A09 0%, #131110 52%, #191713 64%, #15130F 100%)',
        }}
      >
        {/* Ceiling wash */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background:
              'radial-gradient(ellipse 92% 52% at 50% 13%, rgba(34,211,238,0.09), rgba(34,211,238,0) 62%)',
          }}
        />
        {/* The batten, and its bloom */}
        <div
          style={{
            position: 'absolute',
            top: 76,
            left: 108,
            width: 984,
            height: 2,
            background:
              'linear-gradient(90deg, rgba(34,211,238,0) 0%, rgba(34,211,238,0.75) 14%, rgba(160,240,252,0.95) 50%, rgba(34,211,238,0.75) 86%, rgba(34,211,238,0) 100%)',
            boxShadow: '0 0 18px 2px rgba(34,211,238,0.35), 0 0 70px 16px rgba(34,211,238,0.10)',
          }}
        />
        {/* Wall/floor seam.
            76% here, against the stylesheet's 64%. The plate fills a viewport
            and this fills a 1.91:1 crop, so the same fraction puts the horizon
            straight through the headline's second line — it read as a rule
            struck through "knows your car". Dropped until both lines and the
            subhead sit on the wall. The one number in this file that is
            deliberately not the stylesheet's. */}
        <div
          style={{
            position: 'absolute',
            top: 479,
            left: 0,
            width: '100%',
            height: 1,
            background: 'rgba(255,255,255,0.045)',
          }}
        />
        {/* Floor sheen, and the batten reflected in it */}
        <div
          style={{
            position: 'absolute',
            top: 480,
            left: 0,
            width: '100%',
            height: 150,
            background: 'linear-gradient(180deg, rgba(255,255,255,0.028), rgba(255,255,255,0) 45%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 480,
            left: 0,
            width: '100%',
            height: 150,
            background:
              'radial-gradient(ellipse 52% 38% at 50% 20%, rgba(34,211,238,0.06), rgba(34,211,238,0) 72%)',
          }}
        />
        {/* Corner falloff */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background:
              'radial-gradient(120% 100% at 50% 30%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.35) 100%)',
          }}
        />

        {/*
          ── The plate, restated because Satori renders JSX and not components ─

          `BrandLockup` cannot be used here: this renders through Satori, which
          takes a JSX tree rather than a React component tree with our imports.
          What it *can* share is the numbers — the path, the rivets and the
          colours come from `@wellkept/core/brand`, so the card cannot drift
          from the mark the app draws even though the drawing is restated.

          ⚠ The engraved name is set in Satori's default face, not Newsreader.
          Loading a webfont here means a network fetch inside `next build`, and
          this build is the promote gate for the hostname the App Store points
          at — a font CDN having a bad minute would fail a deploy. Design's own
          README makes the matching point about rasterisers substituting fonts;
          the honest version at this size is the plate carrying capitals in the
          face that is actually present.
        */}
        <div
          style={{
            position: 'absolute',
            top: 132,
            left: 108,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {/*
            ⚠ **The plate is paths and the name is a div**, and that split is
            not stylistic.

            Satori refuses SVG text outright — *"<text> nodes are not currently
            supported, please convert them to <path>"* — and the way it refuses
            is the dangerous part: the route still answers **200 with
            `content-type: image/png` and a zero-byte body**. A scraper sees a
            valid response and a broken picture, and nothing in the app looks
            wrong. Caught by generating the card and measuring it; it would not
            have shown up in any test that reads source.

            So the plate is drawn as paths, which Satori does support, and the
            engraved name is a positioned div, which is how the wordmark on
            this card has always been set.
          */}
          <div style={{ position: 'relative', display: 'flex', width: 240, height: 82 }}>
            <svg width="240" height="82" viewBox={`0 0 ${PLATE.short.width} ${PLATE.short.height}`}>
              <path
                d={PLATE.short.path}
                fill={BRAND_COLOR.plate}
                stroke={BRAND_COLOR.edge}
                strokeWidth={2}
              />
              {RIVETS.short.map((rivet) => (
                <circle
                  key={`${rivet.x}-${rivet.y}`}
                  cx={rivet.x}
                  cy={rivet.y}
                  r={RIVETS.radius}
                  fill={BRAND_COLOR.rivet}
                />
              ))}
            </svg>
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: 240,
                height: 82,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 26,
                letterSpacing: '0.1em',
                color: BRAND_COLOR.name,
              }}
            >
              {BRAND_NAME.toUpperCase()}
            </div>
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            top: 236,
            left: 108,
            display: 'flex',
            flexDirection: 'column',
            width: 840,
          }}
        >
          <div style={{ fontSize: 68, fontWeight: 700, color: '#FFFFFF', letterSpacing: '-0.025em', lineHeight: 1.08 }}>
            An AI that keeps the record, so the care keeps itself.
          </div>
          {/*
            ⚠ **Per site, and it was not.** This line read "Live demo with
            sample vehicles — no signup required" on *both* deployments — so the
            share card for `crewchief.davidmasterson.co`, which is the App Store
            listing's marketing URL, described the product as a demo.

            `39f7f0b` fixed exactly this on the landing page and `site-role.ts`
            states the rule — *"the product copy must not describe Well Kept as
            a demo"* — and the card was missed because it is generated by a
            convention route rather than rendered inside the app.
          */}
          <div style={{ marginTop: 26, fontSize: 30, color: 'rgba(255,255,255,0.55)', lineHeight: 1.35 }}>
            {isDemoSite(process.env.CREWCHIEF_DEMO_SITE)
              ? 'Live demo with sample vehicles — no signup required'
              : 'Every invoice read, every interval anchored.'}
          </div>
        </div>
      </div>
    ),
    size
  );
}
