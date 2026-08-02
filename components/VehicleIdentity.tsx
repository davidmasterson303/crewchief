'use client';

import { useEffect, useRef, useState } from 'react';
import { Car } from 'lucide-react';
import { vehicleField } from '@crewchief/core/vehicle-identity';

/**
 * What a vehicle looks like — one component, two variants.
 *
 * ── The inversion this component exists to make ─────────────────────────────
 *
 * The no-photo state is the **primary** design, not the fallback. The photo
 * variant is the same box with a photograph swapped in behind the field: same
 * height, same type positions, same everything. A photograph can therefore
 * never break the layout, because the layout already worked without one.
 *
 * That is the whole reason `/vehicles/default/hero-3x2.jpg` and
 * `/vehicles/placeholder.jpg` could both 404 unnoticed — with three seeded
 * vehicles all carrying hand-placed files, no code path ever rendered the
 * absent case. The first real user vehicle would have found it.
 *
 * ── contain-over-blur, and why it is load-bearing ───────────────────────────
 *
 * The sharp copy is **contained**, never cropped, over a blurred copy of
 * itself that fills the width. A landscape DSLR frame and a vertical phone
 * snapshot both land whole and centred.
 *
 * This is what makes unpredictable user uploads safe, and it removes every
 * aspect-ratio breakpoint from the layout. The previous hero cropped `cover`
 * anchored at centre, which on a 3:4 phone photo of a car — the overwhelmingly
 * common case — enlarged it ~3x and kept a horizontal band through the
 * vertical middle: sky, ceiling, or garage lights. The car was frequently not
 * in the hero at all.
 *
 * ── Nothing is printed over a photograph ────────────────────────────────────
 *
 * No tint, no scrim, no vignette. The previous hero composited through six
 * layers and measured ~1.7% passthrough at the bottom edge; roughly a tenth of
 * each 700 KB photograph did any visual work.
 *
 * The consequence for this component: when a photo renders, the type and the
 * glyph do **not**. They belong to the field. Callers put a vehicle's name in
 * the layout around the band, not on top of it.
 */

export type VehicleIdentityVariant = 'card' | 'band';

interface VehicleIdentityProps {
  variant: VehicleIdentityVariant;
  /**
   * A renderable photo URL, or null. **Null is the expected case.**
   *
   * Already-signed: callers resolve storage paths through `useVehicleImage`
   * before this point, because signing is an async server round trip and this
   * component is pure presentation.
   */
  photo?: string | null;
  year?: number | string | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  /** Band height. The design default is 400px; it is a prop so it can flex. */
  height?: number;
  className?: string;
}

/**
 * The AVIF and WebP siblings of a demo photograph, if it has any.
 *
 * Only the files under `public/vehicles/` are built into three formats — by
 * `scripts/build-image-derivatives.mjs`, which commits its output next to the
 * JPEG. Everything else reaching this component is an owner upload arriving as
 * a Supabase signed URL, which has exactly one representation and must be
 * offered as-is: the signature covers a specific object, so inventing a
 * sibling path would produce a 403 rather than a photograph.
 *
 * Returns `null` for those, and every caller then falls back to the plain URL.
 */
function photoFormats(src: string | null): { avif: string; webp: string } | null {
  if (!src || !src.startsWith('/vehicles/') || !/\.jpe?g$/i.test(src)) return null;
  const stem = src.replace(/\.jpe?g$/i, '');
  return { avif: `${stem}.avif`, webp: `${stem}.webp` };
}

/**
 * The two custom properties `.photo-layer` reads: a plain `url()` every browser
 * understands, and an `image-set()` only newer ones are shown. See the class in
 * globals.css for why both have to exist.
 */
function photoLayerVars(
  src: string,
  formats: { avif: string; webp: string } | null
): React.CSSProperties {
  const fallback = `url(${JSON.stringify(src)})`;
  const set = formats
    ? `image-set(url(${JSON.stringify(formats.avif)}) type("image/avif"), ` +
      `url(${JSON.stringify(formats.webp)}) type("image/webp"), ` +
      `${fallback} type("image/jpeg"))`
    : fallback;
  return { '--photo-fallback': fallback, '--photo-set': set } as React.CSSProperties;
}

export function VehicleIdentity({
  variant,
  photo,
  year,
  make,
  model,
  trim,
  height = 400,
  className = '',
}: VehicleIdentityProps) {
  /*
    A URL is not a photograph. The object can be missing for reasons no caller
    can check in advance — deleted out from under its row, or a signed URL
    minted against something no longer there — and §1 is explicit that a broken
    image must never render. So the load failure is the signal.

    The failed *URL* is remembered rather than a boolean: signed URLs are
    re-minted roughly every 30 minutes, so a fresh one gets another attempt
    without a remount, and a transient failure heals itself.
  */
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const src = photo && photo !== failedUrl ? photo : null;
  const formats = photoFormats(src);

  /*
    The photo fades in over the plate instead of appearing between frames.

    Owner photos arrive as signed URLs, so `useSignedUrl` returns undefined
    while the exchange is in flight and the plate is what renders underneath —
    the layout never moves, which is why this reads as a pop rather than a
    jump. A 200ms fade is enough to make the arrival deliberate.

    Keyed on the URL so a re-minted signed URL fades its replacement in rather
    than flashing the plate: `loadedUrl` is compared to the current `src`, the
    same shape as `failedUrl` directly above and for the same reason.

    A cached image fires `load` before paint, so this costs nothing on a repeat
    view — the fade runs from an already-opaque start.
  */
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const photoReady = src !== null && loadedUrl === src;

  /*
    `onLoad` alone would leave the photograph invisible forever on the exact
    case that is meant to be fastest.

    This is a client component, so Next still renders it to HTML on the server;
    the probe is in that HTML and the browser can finish fetching it — from
    cache, most of the time — before hydration attaches any handler. The load
    event has then already fired, nothing is listening, `loadedUrl` never
    updates, and both layers stay at `opacity: 0` over the plate. A fade-in
    that fails closed on a cache hit is worse than no fade-in at all.

    So the element is asked directly on mount rather than waited on.
    `naturalWidth` is what separates a finished load from a finished failure —
    `complete` is true for both, and treating an error as a load would fade in
    an empty box over the plate the error handler had just chosen.
  */
  const probeRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const probe = probeRef.current;
    if (probe?.complete && probe.naturalWidth > 0) setLoadedUrl(src);
  }, [src]);

  const field = vehicleField(make);
  const isBand = variant === 'band';

  // `{year} {make} · {trim}` — each part optional, and the separator only
  // earns its place when there is something on both sides of it.
  const lead = [year, make].filter(Boolean).join(' ');
  const subtitle = [lead, trim].filter(Boolean).join(' · ');

  return (
    <div
      className={`relative overflow-hidden ${isBand ? '' : 'rounded-t-2xl'} ${className}`}
      style={{
        // The field is always painted, even under a photograph. It is what the
        // blurred layer's translucent edges sit on, and what shows for the
        // instant before a photo decodes.
        background: field.gradient,
        ...(isBand
          ? { height: `${height}px`, borderBottom: '1px solid rgb(255 255 255 / 0.08)' }
          : { aspectRatio: '3 / 2' }),
      }}
      data-variant={variant}
      data-has-photo={src ? 'true' : 'false'}
    >
      {src ? (
        <>
          {/*
            The blurred fill. `inset: -6%` and `scale(1.08)` together keep the
            blur's own soft edge outside the box — without the overscan, a 34px
            blur feathers into transparency and reveals the container edge as a
            pale halo.
          */}
          <div
            aria-hidden="true"
            className="absolute pointer-events-none photo-layer"
            style={{
              inset: '-6%',
              ...photoLayerVars(src, formats),
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'blur(34px) saturate(.8) brightness(.52)',
              transform: 'scale(1.08)',
              opacity: photoReady ? 1 : 0,
              transition: 'opacity 200ms ease-out',
            }}
          />
          {/* The sharp copy. Contained — the whole vehicle, always. */}
          <div
            className="absolute inset-0 photo-layer"
            style={{
              ...photoLayerVars(src, formats),
              backgroundSize: 'contain',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              opacity: photoReady ? 1 : 0,
              transition: 'opacity 200ms ease-out',
            }}
            role="img"
            aria-label={[lead, model].filter(Boolean).join(' ') || 'Vehicle photo'}
          />
          {/*
            A CSS background can report neither a load failure nor a load, and
            both are needed here — the no-broken-image rule depends on hearing
            about the first, and the fade-in on the second. This probe is the
            only <img> in the component: zero-area, never painted, present
            solely so `onError` and `onLoad` have somewhere to fire.

            It is wrapped in <picture> so it negotiates format the same way the
            two background layers do. Without that it would request the JPEG
            while the backgrounds requested the AVIF — two downloads of the same
            photograph, and the larger one is the wasted one, which would have
            made the whole derivative exercise a net loss. Matching sources put
            both on the same cache entry: one fetch, as before.
          */}
          <picture>
            {formats && <source srcSet={formats.avif} type="image/avif" />}
            {formats && <source srcSet={formats.webp} type="image/webp" />}
            <img
              ref={probeRef}
              src={src}
              alt=""
              aria-hidden="true"
              className="absolute w-0 h-0 opacity-0 pointer-events-none"
              onLoad={() => setLoadedUrl(src)}
              onError={() => setFailedUrl(src)}
            />
          </picture>
          {/* Top highlight — the band's only decoration, and it is not over the photo. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none"
            style={{ boxShadow: 'inset 0 1px 0 rgb(255 255 255 / .06)' }}
          />
        </>
      ) : (
        <>
          {/*
            The oversized glyph, bleeding off the bottom-right corner.

            Decorative, at 11% — it is texture, not information. The twelve
            body-style silhouettes in components/vehicle-illustrations are the
            *informative* set: they tell an owner which body style the VIN
            decoded to. Do not swap one for the other without deciding which
            job the art is doing; using an informative silhouette at 11%
            opacity wastes it.
          */}
          <Car
            aria-hidden="true"
            className="absolute pointer-events-none text-white"
            strokeWidth={0.55}
            style={{
              width: isBand ? 230 : 150,
              height: isBand ? 230 : 150,
              right: isBand ? -28 : -18,
              bottom: isBand ? -46 : -30,
              opacity: 0.11,
            }}
          />

          <div
            className={`absolute left-0 right-0 bottom-0 ${isBand ? 'p-8' : 'p-5'}`}
          >
            {model && (
              <p
                className="display-serif text-white tracking-tight leading-none truncate"
                style={{ fontSize: isBand ? '2.25rem' : '1.5rem' }}
              >
                {model}
              </p>
            )}
            {subtitle && (
              <p
                className="text-white/55 mt-1.5 truncate"
                style={{ fontSize: '12.5px' }}
              >
                {subtitle}
              </p>
            )}
          </div>

          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none"
            style={{ boxShadow: 'inset 0 1px 0 rgb(255 255 255 / .06)' }}
          />
        </>
      )}
    </div>
  );
}
