import * as Notifications from 'expo-notifications';

/**
 * Phase 5 — recall and service-due alerts.
 *
 * `cc-product-0001` calls push "part of the argument for a native app existing
 * at all", and the features doc is explicit that web push is not a substitute.
 * This is the client half.
 *
 * ── Why this needed no cloud build ──────────────────────────────────────────
 *
 * Because `expo-notifications` was compiled into `29b4d76f` alongside the
 * camera on 5 Aug, specifically so Phase 5 would not cost a second build out of
 * fifteen a month. That batching decision is what makes this ordinary work.
 *
 * ── A tapped notification is a deep link, and reuses that machinery ─────────
 *
 * A push carries `data.url`, and the navigator's `linking` config resolves it.
 * There is deliberately **no second routing table**: notifications and links
 * land on the same screens by the same rules, so a route added to one is
 * reachable from the other without anyone remembering to update a mapping.
 * That is the same argument as `@wellkept/core`'s shared modules, applied to
 * navigation — two implementations of one rule is what this codebase keeps
 * finding.
 *
 * `notificationUrl` is deliberately strict about what it accepts. A push
 * payload arrives from the network and is the one input here an attacker could
 * shape, so only `crewchief://` survives: an `https://` url in that field would
 * otherwise send someone to an arbitrary website from a notification that looks
 * like it came from their garage.
 *
 * ── What is NOT here yet, and why ───────────────────────────────────────────
 *
 * **Token registration.** Getting an Expo push token and storing it server-side
 * needs a table to store it in, which needs a migration, which on this project
 * is applied by hand through the Supabase dashboard. So the device half is
 * built and verified first and the round trip waits on that migration — the
 * same order 3.3 was built in.
 *
 * A simulator also cannot produce a real push token. It *can* receive a
 * notification via `xcrun simctl push`, which is what makes everything below
 * verifiable today.
 */

/**
 * How a notification behaves when it arrives while the app is open.
 *
 * Without a handler, iOS shows nothing in the foreground — the alert is
 * delivered and silently discarded, which reads as "push is broken" when it is
 * working exactly as configured.
 *
 * A recall notice for your car is worth interrupting for even if you happen to
 * be looking at the app, so it is shown either way. It is not a chat message
 * arriving every few seconds.
 */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      // No badge. A count on the icon implies an inbox to clear, and there is
      // no screen in this app that lists notifications.
      shouldSetBadge: false,
    }),
  });
}

/**
 * Ask for permission to send alerts.
 *
 * Returns whether it was granted. **Never throws** — a refused prompt is an
 * ordinary answer, and the caller carries on without alerts rather than
 * treating it as a failure.
 *
 * ⚠ **Where this is called from is a product decision, not a technical one.**
 * iOS allows the prompt exactly once; a "no" can only be undone in Settings.
 *
 * This used to say the prompt was raised on entry to the signed-in stack and
 * that the explanatory screen "is worth building before submission and is not
 * built". **Both halves stopped being true on 12 Aug 2026** — C5 built
 * `PushPrimer`, and the navigator now registers silently only when permission
 * already exists.
 *
 * So this function is no longer called from anywhere that raises the dialog
 * uninvited: `GarageScreen` offers the primer once someone has a car, and
 * `registerForPush` runs from its accept path. `shouldShowPushPrimer` in
 * `@wellkept/core/push-priming` owns the rule, and
 * `push-primer-wiring.test.ts` fails if a caller reintroduces the old shape.
 */
export async function requestPushPermission(): Promise<boolean> {
  try {
    const existing = await Notifications.getPermissionsAsync();

    // Asking again when the answer is already recorded shows nothing and
    // wastes a round trip. iOS will not re-prompt regardless.
    if (existing.granted) return true;
    if (!existing.canAskAgain) return false;

    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  } catch {
    // Push is an enhancement. A device that cannot answer the question — a
    // simulator without a push entitlement, most often — must not take the
    // signed-in stack down with it.
    return false;
  }
}

/**
 * The in-app URL a notification wants opened, or `null`.
 *
 * Only `crewchief://` is accepted. See the header: this field arrives over the
 * network, and honouring an arbitrary scheme here would turn a notification
 * into an open redirect.
 */
export function notificationUrl(notification: Notifications.Notification | null | undefined): string | null {
  const data = notification?.request?.content?.data as Record<string, unknown> | undefined;
  const url = data?.url;

  if (typeof url !== 'string') return null;
  if (!url.startsWith('crewchief://')) return null;

  return url;
}

/**
 * The URL of a notification that was tapped while the app was **not running**.
 *
 * A cold start from a notification has no `Linking` url — the app was opened by
 * the tap, not by a link — so this is the only way that journey is recoverable.
 * Missing it is the classic push bug: alerts work perfectly while the app is
 * backgrounded and do nothing at all from a cold start.
 */
export async function initialNotificationUrl(): Promise<string | null> {
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    return notificationUrl(response?.notification);
  } catch {
    return null;
  }
}

/**
 * Subscribe to taps on notifications while the app is running.
 *
 * Returns an unsubscribe function.
 */
export function subscribeToNotificationTaps(handler: (url: string) => void): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const url = notificationUrl(response.notification);
    if (url) handler(url);
  });

  return () => subscription.remove();
}
