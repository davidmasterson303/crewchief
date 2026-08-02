/*
 * `next/server`, not `next/og`. Every current example writes `next/og` — that
 * path was added in Next 14, and this project is pinned to 13.5.11, where the
 * import resolves to nothing and the build fails with "Module not found".
 * Move it when Next is upgraded; the same note is on the Newsreader font in
 * layout.tsx, for the same pin.
 */
import { ImageResponse } from 'next/server';

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
export const alt = 'CrewChief — an AI consultant that knows your car';
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

        {/* Wordmark. The lucide `car-front` path the nav uses, drawn at 40px so
            the card carries the same mark as the page it opens. */}
        <div
          style={{
            position: 'absolute',
            top: 148,
            left: 108,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
            <circle cx="7" cy="17" r="2" />
            <path d="M9 17h6" />
            <circle cx="17" cy="17" r="2" />
          </svg>
          <div style={{ marginLeft: 16, fontSize: 34, fontWeight: 600, color: '#FFFFFF', letterSpacing: '-0.01em' }}>
            CrewChief
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
          <div style={{ fontSize: 76, fontWeight: 700, color: '#FFFFFF', letterSpacing: '-0.025em', lineHeight: 1.05 }}>
            An AI consultant that knows your car
          </div>
          <div style={{ marginTop: 26, fontSize: 30, color: 'rgba(255,255,255,0.55)', lineHeight: 1.35 }}>
            Live demo with sample vehicles — no signup required
          </div>
        </div>
      </div>
    ),
    size
  );
}
