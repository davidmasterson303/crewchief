import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

import { apiRequest } from '../api/client';
import { secureStorage } from '../auth/secure-storage';
import type { PushPermission } from '@crewchief/core/push-priming';
import { isExpoPushToken } from '@crewchief/core/push-tokens';
import { requestPushPermission } from './push';

/**
 * Telling the server where to send this device's notifications.
 *
 * Phase 5's remaining client work. Permission, delivery and tap-routing shipped
 * on 5 Aug; none of it could ever fire, because the server had no address to
 * send to.
 *
 * ── The device id is generated here, not read off the hardware ──────────────
 *
 * `expo-device` exposes real identifiers and is **not installed** — adding it
 * would spend one of fifteen monthly cloud builds for something this does not
 * need. A random id minted once and kept in the Keychain is stable for the
 * life of an install, which is exactly the lifetime a push token has.
 *
 * It is also the better answer on privacy, not merely the cheaper one. A
 * hardware identifier is stable across *uninstalls* and correlates a person
 * across apps; this one dies with the app and correlates nothing. The table
 * storing it says the same: no device name, no model, no OS version.
 *
 * `Math.random` is fine for it. This is an opaque local label whose only
 * requirement is not colliding with the same account's other handset — it is
 * not a secret, it authenticates nothing, and treating it as though it did
 * would imply a guarantee it does not carry.
 *
 * ── Why registration is best-effort ─────────────────────────────────────────
 *
 * Push is an enhancement. A signed-in person with a working garage must not
 * see an error because a notification address could not be filed, so every
 * failure here is logged and swallowed. The one thing that would be worse than
 * no notifications is an app that will not open without them.
 */

const DEVICE_ID_KEY = 'crewchief.device-id';

/**
 * When the user last said "not now" to the primer. C5.
 *
 * In the Keychain beside the device id rather than in a server column, and that
 * is deliberate: the question it answers is "has this *install* been asked
 * recently", and iOS permission is per-install too. A server-side flag would
 * suppress the primer on a new phone where the system ask is available again.
 */
const PRIMER_DISMISSED_KEY = 'crewchief.push-primer-dismissed';

/** A v4-shaped random id. Opaque, local, and not a credential — see the header. */
function newDeviceId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/**
 * This install's id, minted on first use.
 *
 * Stored through the same Keychain adapter the session uses, so it survives an
 * app restart and disappears with the app.
 */
export async function deviceId(): Promise<string> {
  const existing = await secureStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const id = newDeviceId();
  await secureStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

export type RegistrationResult =
  | { status: 'registered' }
  /** Permission refused, or the device cannot mint a token — a simulator. */
  | { status: 'unavailable'; reason: string };

/**
 * Ask for permission, get a push token, and file it against this account.
 *
 * Returns rather than throws. The caller is a signed-in screen with nothing
 * useful to do about a failure, and push not working must never look like the
 * app not working.
 */
export async function registerForPush(): Promise<RegistrationResult> {
  try {
    const granted = await requestPushPermission();
    if (!granted) return { status: 'unavailable', reason: 'Notifications are turned off.' };

    /*
      `projectId` is required for a token in a development build — without it
      Expo cannot tell which project the device is registering against, and
      the call throws rather than returning null. It comes from the same
      `app.json` block the EAS build uses.
    */
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
      ?.eas?.projectId;

    const token = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );

    if (!isExpoPushToken(token?.data)) {
      /*
        A simulator reaches here: it can *receive* a notification via
        `xcrun simctl push`, but it cannot be issued a real push token, so
        there is nothing to file. Reported as unavailable rather than as an
        error, because on that device it is the correct outcome.
      */
      return { status: 'unavailable', reason: 'This device cannot receive push notifications.' };
    }

    await apiRequest('/push-token', {
      method: 'POST',
      body: {
        expoPushToken: token.data,
        deviceId: await deviceId(),
        platform: 'ios',
      },
    });

    return { status: 'registered' };
  } catch (error) {
    // Swallowed deliberately — see the header. Push is an enhancement.
    console.warn('[Push] Could not register this device:', error);
    return { status: 'unavailable', reason: 'Could not reach CrewChief.' };
  }
}

/**
 * Stop sending to this device.
 *
 * Called on sign-out. A handed-on phone must not keep receiving the previous
 * owner's recall notices, and waiting for a retirement sweep to notice is not
 * an answer — the sweep's signal is *inactivity*, and a device that was signed
 * out and then sold looks identical to one on a shelf.
 */
export async function unregisterPush(): Promise<void> {
  try {
    const id = await deviceId();
    await apiRequest(`/push-token?deviceId=${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (error) {
    /*
      Best-effort, and the failure is bounded: the row's `last_registered_at`
      stops advancing, so the retirement sweep collects it eventually. Blocking
      sign-out on this would be worse — someone trying to leave would be held
      by a network call.
    */
    console.warn('[Push] Could not unregister this device:', error);
  }
}


/**
 * The permission state, in the vocabulary the priming rule speaks.
 *
 * `expo-notifications` reports `granted` plus `canAskAgain`, which is two
 * booleans describing three states. Collapsing them here means
 * `shouldShowPushPrimer` never has to reason about the combination, and the one
 * that matters — *asked and refused* versus *never asked* — is named rather
 * than inferred at each call site.
 */
export async function currentPushPermission(): Promise<PushPermission> {
  try {
    const status = await Notifications.getPermissionsAsync();
    if (status.granted) return 'granted';
    // Not granted and cannot ask again is the irreversible one: iOS will not
    // show its dialog, so only Settings can change the answer.
    return status.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    /*
      Reported as `denied` rather than `undetermined`, which is the quiet
      direction. A device that cannot answer the question must not be shown a
      screen that leads to a system prompt that will also fail — the person
      would refuse a dialog that never appeared, and on a real device that
      refusal would be permanent.
    */
    return 'denied';
  }
}

/** The date the primer was last declined on this install, or null. */
export async function primerDismissedOn(): Promise<string | null> {
  try {
    return await secureStorage.getItem(PRIMER_DISMISSED_KEY);
  } catch {
    return null;
  }
}

/**
 * Record a "not now".
 *
 * Stores a date rather than a boolean so the cooldown can expire. A boolean
 * would make the first decline permanent, and somebody who was busy the first
 * time would never be asked again — a worse outcome than not having a primer,
 * because the system ask stays unspent forever.
 */
export async function recordPrimerDismissed(today: string): Promise<void> {
  try {
    await secureStorage.setItem(PRIMER_DISMISSED_KEY, today);
  } catch {
    // A failure here costs one repeated screen, not a lost permission.
  }
}
