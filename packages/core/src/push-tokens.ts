/**
 * What an Expo push token looks like.
 *
 * ── Why this is in core ─────────────────────────────────────────────────────
 *
 * Two callers, and they must agree. The route refuses a malformed token at the
 * boundary so a bad row cannot exist; the device checks before sending so it
 * does not spend a round trip learning something it could have known. A second
 * copy of the pattern would drift, and the direction it drifts matters: a
 * client that is stricter than the server rejects working devices, and one
 * that is looser stores addresses that can never be delivered to.
 *
 * Same rule as `health-band` and `consultant-context-kinds` — what a value
 * *is* lives here; what either side does about it stays with that side.
 *
 * ── Why the shape is checked at all ─────────────────────────────────────────
 *
 * Anything stored is later handed to Expo's push service. A row holding a value
 * that is not a token is a send that fails once per notification, forever, for
 * a device that will never receive one — and it fails far from the request that
 * created it. Refusing at the edge keeps the diagnosis local.
 *
 * ── Deliberately not a strict format ────────────────────────────────────────
 *
 * The inner text is opaque and Expo's to change. This checks the wrapper and
 * that something is inside it, and nothing more: a tighter pattern would turn
 * their release note into our outage. It is a sanity check against storing a
 * session token, an empty string or a device name by mistake — not an
 * authentication of the value.
 */

/**
 * `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]`, and its newer `ExpoPushToken`
 * spelling. Both are in circulation; accepting only one would refuse real
 * devices depending on SDK age.
 */
const EXPO_PUSH_TOKEN = /^Exp(o|onent)PushToken\[[^\]\s]+\]$/;

export function isExpoPushToken(value: unknown): value is string {
  return typeof value === 'string' && EXPO_PUSH_TOKEN.test(value.trim());
}
