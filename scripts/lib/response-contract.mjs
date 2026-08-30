/**
 * What a mobile client is promised about response *bodies*.
 *
 * `verify-mobile-contract.mjs` checked status codes, the CORS preflight and
 * bearer-vs-cookie behaviour, and asserted nothing whatever about the JSON. So
 * a route could `select('*')` and ship a `placeholder://` storage path — a
 * value no client outside this repo can resolve — and sit in the contract for
 * weeks looking green. That happened twice, in `load-vehicle` and then in
 * `vehicles`, and the second one was found by reading the tree rather than by
 * any check.
 *
 * Pure and separate from the script so it can be tested against synthetic
 * responses instead of trusted for being green — the standard `cc-tech-0004`
 * sets, and the same reason `findDelegationLeaks` lives apart from the suite
 * that uses it. Probing this one for real would mean deploying a deliberately
 * broken route.
 */

/**
 * Copied from `@wellkept/core/storage-paths` rather than imported: this file
 * is plain ESM run by `node` with no build step, and the package is TypeScript.
 *
 * A copied constant is a constant that drifts, so it does not stand on its own
 * — `response-contract.test.ts` asserts this equals the real export, and fails
 * the build if the scheme is ever changed in one place only.
 */
export const STORED_URL_SCHEME = 'placeholder://';

/**
 * Every path in a JSON value whose string carries the stored-URL scheme.
 *
 * Recursive rather than a per-field check on the fields known to have carried
 * one. The bug is a *class* — any column reachable by a star select — so the
 * check has to be about the shape of the value, not about a list of field
 * names that is only ever as current as the last person to remember it.
 *
 * Returns dotted paths (`vehicles[0].custom_image_url`) because "somewhere in
 * the response" is not actionable at 7am.
 */
export function findUnresolvableUrls(value, path = '') {
  if (typeof value === 'string') {
    return value.startsWith(STORED_URL_SCHEME) ? [`${path || '<root>'} = ${value}`] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, i) => findUnresolvableUrls(item, `${path}[${i}]`));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) =>
      findUnresolvableUrls(item, path ? `${path}.${key}` : key)
    );
  }

  return [];
}

/**
 * Fields present in an object, reported as what is missing.
 *
 * `null` counts as present: `photo_url: null` is a car with no photo, which is
 * a real answer and different from a response that forgot to mention photos.
 * Conflating the two is how a client ends up unable to tell "no photo" from
 * "this endpoint changed under me".
 */
export function findMissingFields(object, required) {
  if (!object || typeof object !== 'object') return [...required];
  return required.filter((field) => !(field in object));
}

/**
 * Fields that must never appear on the wire.
 *
 * Distinct from findUnresolvableUrls: that catches a bad *value*, this catches
 * a column that should have been stripped even when it happens to be null.
 * A null custom_image_url today is a placeholder:// tomorrow.
 */
export function findLeakedFields(object, forbidden) {
  if (!object || typeof object !== 'object') return [];
  return forbidden.filter((field) => field in object);
}
