import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { vehicleFieldStops } from '@crewchief/core/vehicle-identity';

import { radius, space, text, type } from '../theme';

/**
 * The identity plate — the phone's version of CC-142.
 *
 * ── What this replaces, and why it was wrong ────────────────────────────────
 *
 * The garage card rendered a grey box containing the words **"No photo"**.
 * That is a placeholder, not a design: it names an absence, so a garage of
 * unphotographed cars reads as a garage of incomplete records.
 *
 * Web settled this and mobile never got it. v7 had shrunk the photo to a strip
 * that appeared *only* when a photograph existed, reasoning that "a card that
 * is complete without a photo is better than a card that is never allowed to
 * lack one" — sound, and premised on the no-photo state looking broken. CC-142
 * removed the premise: the no-photo state became **a deterministic make-derived
 * field with the vehicle named on it**, which is a finished design rather than
 * an absence, and so earns the space v7 correctly denied it.
 *
 * ⚠ The two halves only make sense together. A plate without the lockup
 * reinstates exactly the bug v7 was avoiding.
 *
 * ── Why the colour comes from core ──────────────────────────────────────────
 *
 * `vehicleFieldStops` is `vehicleField` in a notation React Native can read —
 * same hash, same three axes, converted out of `oklch()` because RN's colour
 * grammar has no such function and its StyleSheet has no gradient at all. A
 * BMW is the same blue on both clients or it is two designs.
 *
 * ── The field is painted under a photograph too ─────────────────────────────
 *
 * Not only as a fallback. It is what shows for the instant before a photo
 * decodes, so the card never flashes an empty rectangle on its way to an
 * image — the same reason the web plate paints unconditionally.
 */

/**
 * How long a photo may stay unresolved before the plate gives up on it.
 *
 * ── Two exits from "loading", not one ───────────────────────────────────────
 *
 * A React Native `Image` pointed at a URL that never responds stays loading
 * indefinitely. It draws nothing and `onError` never fires, because nothing has
 * failed — so a fallback gated on failure is unreachable and the card shows a
 * blank rectangle the colour of itself, forever.
 *
 * Measured on the simulator, 1 Aug: inside one render, a `fetch` of the API
 * host returned 200 while a `fetch` of this vehicle's signed storage URL did
 * not resolve within eight seconds. Same app, same network, same moment. The
 * request hangs; it does not fail.
 *
 * A phone on a weak connection produces the identical shape, which makes it a
 * product state rather than an environment quirk. So loading exits on an error
 * *or* on running out of patience, and both land on the lockup: a picture that
 * has not arrived and a picture that does not exist look the same to the person
 * holding the phone, and both mean the car has to name itself.
 *
 * ── The measurement history, moved here with the behaviour ─────────────────
 *
 * Measured 1 Aug, in this order, because the first three readings were wrong:
 *
 *   - `fetch` of the URL from inside the app did not resolve in 8s, while a
 *     control fetch to the API host returned 200. **That comparison was
 *     invalid** — React Native's `fetch` runs on XMLHttpRequest and buffers the
 *     whole body, so it measured 2.3 MB against a few hundred bytes of JSON,
 *     not reachability.
 *   - Cowork fetched the same signed URL from the host: 200, image/jpeg, all
 *     2.3 MB in 1.23s. The object and the URL are fine.
 *   - 90s timeout: still nothing. So it is not slow, it is stuck.
 *   - A tiny inline PNG beside it rendered immediately. So `Image` is fine and
 *     this file specifically is not decodable here.
 *
 * **The fix this comment used to recommend does not exist.** It said to sign a
 * *transformed* URL sized for a list. `47af5c4` tried that the next day and
 * Supabase image transformation returns `FeatureNotEnabled` for this tenant —
 * verified against the live API, not inferred from a pricing page. The server
 * cannot re-encode either: `sharp` is a devDependency whose outputs are
 * committed precisely because Netlify never runs it.
 *
 * What is actually true now:
 *
 *   - **This object is legacy.** 2,328,761 bytes, uploaded 2026-07-28 00:42
 *     UTC, sixteen hours before `eb320f9` wired the browser downscale. It is
 *     the one file the client-side fix could never have caught.
 *   - **New uploads cannot repeat it.** `47af5c4` put a 1.5 MB ceiling at
 *     `uploadVehiclePhoto`, the one chokepoint every upload passes, against a
 *     150 KB target — so a file arriving above it means the downscale did not
 *     run, which is the case worth refusing rather than storing forever.
 *   - **The remaining instance is fixable by hand in about thirty seconds**:
 *     re-upload the M235i photo in the web app and it downscales on the way in.
 *
 * So this timeout stays, because a phone on a weak connection produces the same
 * shape as an undecodable file and both have to land somewhere. A genuinely
 * card-sized image still needs either the paid transform feature or a
 * derivative generated at upload — both decisions with a cost, neither taken.
 */
const PHOTO_TIMEOUT_MS = 6000;

export default function VehiclePlate({
  photo,
  year,
  make,
  model,
  trim,
  height = 172,
}: {
  /** Signed URL, or null when there is none. */
  photo?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  /**
   * Rendered height in points.
   *
   * A fixed height rather than the web plate's 3:2 aspect ratio, and
   * deliberately: 172 is the height the garage card already shipped with, and
   * the point of the plate is that a garage of mixed vehicles does not look
   * ragged — every card the same height matters more here than matching web's
   * ratio on a screen whose width the card does not choose.
   */
  height?: number;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const showPhoto = Boolean(photo) && !failed;

  useEffect(() => {
    if (!photo || loaded || failed) return;
    const timer = setTimeout(() => setFailed(true), PHOTO_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [photo, loaded, failed]);

  /*
    Reset when the URL changes. Signed URLs are re-minted, and without this a
    card whose photo timed out once would never try the replacement.
  */
  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [photo]);

  const field = vehicleFieldStops(make);

  /*
    CSS states a gradient as an angle where 0 points up and 90 points right;
    SVG states one as two points in the box. This converts direction faithfully
    — `(sin θ, −cos θ)` in screen coordinates — and does not reproduce CSS's
    corner-to-corner length rule, which would change the *rate* of the ramp
    rather than its direction. On a two-stop field at card size that difference
    is not visible; on anything with a hard stop it would be.
  */
  const radians = (field.angle * Math.PI) / 180;
  const dx = Math.sin(radians) / 2;
  const dy = Math.cos(radians) / 2;

  // `{year} {make} · {trim}` — each part optional, and the separator only earns
  // its place when there is something on both sides of it.
  const lead = [year, make].filter(Boolean).join(' ');
  const subtitle = [lead, trim].filter(Boolean).join(' · ');

  return (
    <View style={[styles.plate, { height }]}>
      {/*
        The field. Always painted — under the photograph as well as instead of
        it — so nothing ever renders as an empty rectangle.
      */}
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="field" x1={0.5 - dx} y1={0.5 + dy} x2={0.5 + dx} y2={0.5 - dy}>
            <Stop offset="0" stopColor={field.from} />
            <Stop offset="1" stopColor={field.to} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#field)" />
      </Svg>

      {showPhoto ? (
        <Image
          source={{ uri: photo! }}
          style={StyleSheet.absoluteFill}
          /*
            `contain`, not `cover`. The plate *holds* the photograph rather than
            cropping it — which is what retired the focal-point crop on web —
            and the field fills whatever the photo does not.
          */
          resizeMode="contain"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          accessibilityRole="image"
          accessibilityLabel={[lead, model].filter(Boolean).join(' ') || 'Vehicle photo'}
        />
      ) : (
        /*
          The lockup, and it is the whole point of the plate.

          Rendered only when there is no photograph: the card body already names
          the car underneath, so printing it over a photo as well would say the
          same thing twice. Without a photo the plate is the only thing in that
          space, and a field with nothing on it is decoration.
        */
        <View style={styles.lockup}>
          {model ? (
            <Text style={styles.model} numberOfLines={1}>
              {model}
            </Text>
          ) : null}
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  plate: {
    width: '100%',
    overflow: 'hidden',
    borderTopLeftRadius: radius.hero,
    borderTopRightRadius: radius.hero,
    justifyContent: 'flex-end',
  },
  lockup: { padding: space.lg, gap: 2 },
  /**
   * The one editorial role on this card.
   *
   * ⚠ `type.editorial` is the system sans today — the Newsreader serif is not
   * loaded in the native app, and adding a font asset is a native change that
   * costs an EAS build. Sport register already specifies tight heavy Inter, so
   * this is correct there and waiting on the font in standard.
   */
  model: { ...type.editorial, color: text.primary },
  subtitle: { ...type.value, color: text.secondary },
});
