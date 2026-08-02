/**
 * Which derivative a surface should ask for.
 *
 * The demo photographs ship in purpose-built sizes — `hero-3x2` for a
 * page-width band, `card-800` for a ~400px card, plus `portrait-3x4` and
 * `detail-4x3`. The database stores one path per vehicle, and it stores the
 * hero, because that is the largest useful frame and everything else derives
 * from it by name.
 *
 * That naming convention is the rule, and it lives here rather than in a
 * component so the budget tests can assert against the same function the UI
 * calls. A lookup table would have to be kept in step with the seed data;
 * a rule cannot drift from it.
 *
 * Portable: pure string work, no I/O, no browser globals — the React Native
 * client needs the same answer.
 */

/**
 * The card-sized source for a photo path.
 *
 * `/vehicles/<car>/hero-3x2.jpg` → `/vehicles/<car>/card-800.jpg`. The same
 * photograph and the same crop, resized to 800 and re-encoded: 650–861 KB
 * becomes 62–98 KB, and 22–42 KB once AVIF is negotiated.
 *
 * Anything else is returned untouched, which is the important half. An owner
 * upload arrives as a signed URL against a private bucket — the signature
 * covers one object, so a guessed sibling path is a 403 rather than a smaller
 * file. A path that is already a card derivative is left alone too.
 */
export function cardSlotSource(src: string | null | undefined): string | null {
  if (!src) return null;
  const match = src.match(/^(\/vehicles\/[^/]+\/)hero-3x2\.jpe?g$/i);
  return match ? `${match[1]}card-800.jpg` : src;
}
