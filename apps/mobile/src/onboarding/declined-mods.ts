import { secureStorage } from '../auth/secure-storage';

/**
 * Suggestions this owner has said no to.
 *
 * ── ⚠ Why this is on the device and not in the database ─────────────────────
 *
 * A declined rung is **a preference about what to show**, not a fact about the
 * car. Nothing downstream reads it: the health score, the dossier, the recall
 * list and the wishlist are all unchanged by it, and the ladder recomputes from
 * `vehicle_knowledge_base.common_mods` every time either way. Storing an
 * opinion about a list in a table that describes a vehicle would be the first
 * step towards something else reading it as a fact about the vehicle.
 *
 * It is also what makes "Not for me" shippable at all this round. A server-side
 * decline is a new `/api/v1` route, and per `CLAUDE.md` §8 a mobile build that
 * depends on a new route has to wait for a `web-live` promote. Device storage
 * makes the whole feature a JS change.
 *
 * ⚠ **What that costs, stated rather than discovered:** declines do not sync.
 * Sign in on a second phone and the suggestion is back. That is the honest
 * trade for a preference — and it is genuinely the right side of it for
 * something a person can undo in one tap on the screen it appears on. If
 * declines ever need to travel, they need a table and a route, and this module
 * is the one place that changes.
 *
 * ── `secureStorage`, for something that is not a secret ─────────────────────
 *
 * The same argument `first-run-storage.ts` makes: it is the persistence this
 * app already has. Adding `AsyncStorage` for a list of strings would be a
 * second mechanism to keep working, on the platform where a second one is
 * banned outright — `mobile-api-only.test.ts` forbids `AsyncStorage`, because a
 * refresh token once lived in it.
 *
 * ── Failure reads as "nothing declined", and that direction is deliberate ───
 *
 * A read that fails shows the owner a suggestion they may have dismissed, which
 * is a small annoyance they can fix in one tap. The other direction hides a
 * recommendation the product exists to make, silently and permanently, because
 * of a storage error nobody would ever see.
 */

/** Keyed per vehicle: a decline is about one car's build, not about the owner. */
function keyFor(vehicleId: string): string {
  return `crewchief.declinedMods.${vehicleId}`;
}

/**
 * Names are compared case- and space-insensitively.
 *
 * `nextRungs` already matches `completed` this way, and the two have to agree:
 * a suggestion declined as "Cobb Accessport V3" must stay declined when the
 * knowledge base is regenerated and calls it "COBB Accessport V3".
 */
function normalise(name: string): string {
  return name.trim().toLowerCase();
}

export async function declinedMods(vehicleId: string): Promise<string[]> {
  try {
    const stored = await secureStorage.getItem(keyFor(vehicleId));
    if (!stored) return [];

    const parsed: unknown = JSON.parse(stored);
    // Trusts nothing it reads back. A corrupted value must not crash the build
    // screen — it must mean "nothing declined", which is the recoverable state.
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : [];
  } catch {
    return [];
  }
}

/** Returns the new list, so a caller can set state without a second read. */
export async function declineMod(vehicleId: string, name: string): Promise<string[]> {
  const held = await declinedMods(vehicleId);
  if (held.some((n) => normalise(n) === normalise(name))) return held;

  const next = [...held, name.trim()];
  try {
    await secureStorage.setItem(keyFor(vehicleId), JSON.stringify(next));
  } catch {
    /*
      The write failed and the caller still gets the new list, so the row
      disappears for this session. A decline that does not survive a relaunch is
      a much smaller failure than a tap that visibly does nothing, and there is
      nothing useful to say about it — the suggestion simply comes back.
    */
  }
  return next;
}

/** Undo. There is a control for this on the screen — see `BuildScreen`. */
export async function restoreMod(vehicleId: string, name: string): Promise<string[]> {
  const next = (await declinedMods(vehicleId)).filter((n) => normalise(n) !== normalise(name));
  try {
    await secureStorage.setItem(keyFor(vehicleId), JSON.stringify(next));
  } catch {
    /* See above. The suggestion reappears either way, which is the intent. */
  }
  return next;
}
