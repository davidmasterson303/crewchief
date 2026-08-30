import { secureStorage } from '../auth/secure-storage';

/**
 * The one fact the first-run screen turns on: has this install ever had a car?
 *
 * ── ⚠ Why a fact about cars and not a "seen onboarding" flag ────────────────
 *
 * `@wellkept/core/first-run` carries the full argument. In short: a flag set
 * when the screen is displayed records that pixels appeared, and someone who
 * taps into the add-a-car form and backs out has "seen" it — losing the
 * explanation they were still reading. What is worth storing is whether they
 * ever got started, which needs no dismissal button and no Skip.
 *
 * ── On `secureStorage` for something that is not a secret ───────────────────
 *
 * It is not chosen for secrecy. It is the storage this app already has — the
 * push primer's cooldown lives there too — and adding `AsyncStorage` for one
 * boolean would be a second persistence mechanism to keep working, on the
 * platform where a second one costs a native module and a build.
 *
 * ⚠ Both calls swallow their failures, and the read fails *toward showing the
 * screen*. Storage that cannot be read means an unknown answer, and for an
 * empty garage the honest response to "have you done this before" is to
 * explain again. The alternative — treating a read failure as "yes, they know
 * this" — hides the explanation from exactly the person who needs it.
 */

const EVER_HAD_VEHICLE_KEY = 'crewchief.everHadVehicle';

export async function everHadVehicle(): Promise<boolean> {
  try {
    return (await secureStorage.getItem(EVER_HAD_VEHICLE_KEY)) === 'true';
  } catch {
    // Unknown behaves as "no" — see the note above.
    return false;
  }
}

/**
 * Record that a garage has had something in it.
 *
 * Called when a load returns vehicles, not when one is created. The two differ
 * for the case that matters: signing in on a second phone to an account that
 * already has cars never runs a create, and a flag written only on creation
 * would leave that install permanently believing this is someone's first run.
 */
export async function recordEverHadVehicle(): Promise<void> {
  try {
    await secureStorage.setItem(EVER_HAD_VEHICLE_KEY, 'true');
  } catch {
    // Costs one repeated explanation on an empty garage, nothing more.
  }
}
