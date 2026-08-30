import { logger } from '@wellkept/core/logger';
import type { NotificationContent } from '@wellkept/core/notifications';
import { getServiceRoleClient } from '@/lib/supabase';

/**
 * Actually sending a notification.
 *
 * Phase 5's last piece of plumbing. The device asks permission, handles alerts
 * and routes a tap; the table records where to send. This is the part that
 * sends, and it is server-only — hence `lib/` rather than `@wellkept/core`,
 * which is for what both clients agree on. The mobile app receives pushes and
 * has no reason to be able to originate one.
 *
 * ── Why this talks to Expo rather than to APNs ──────────────────────────────
 *
 * Because the tokens are Expo tokens. Going direct to APNs would mean holding
 * an Apple push key in this app's environment, minting JWTs, and — the part
 * that actually decides it — re-doing all of it for Android later. Expo's
 * service is already the thing that issued the addresses in
 * `device_push_tokens`, and the app is an Expo build.
 *
 * ── A dead token is the failure mode that matters ───────────────────────────
 *
 * Everything else here fails loudly and once. `DeviceNotRegistered` fails
 * quietly and **forever**: an app uninstalled or a phone traded in leaves a row
 * that is attempted on every notification, for a handset that will never
 * receive one. Left alone it is a slow leak that eventually dominates every
 * fan-out. Expo reports it per message, so the ticket pass below is the only
 * place that knowledge exists — and it is why `interpretTickets` returns tokens
 * to retire rather than just counting failures.
 *
 * ── Deliberately no receipts pass, and that is a real gap ───────────────────
 *
 * Expo tickets say "accepted for delivery". **Receipts**, fetched later by
 * ticket id, say what happened — and some `DeviceNotRegistered` answers only
 * appear there. That needs somewhere to park ticket ids between two runs, which
 * means another table, which means another hand-applied migration. The tickets
 * catch the common case (an uninstall Expo already knows about) and the
 * `last_registered_at` sweep the migration indexes for catches the rest. Worth
 * revisiting when there is a second migration to apply anyway.
 */

/** Expo's push endpoint. Exported so a test can assert what is called. */
export const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

/**
 * Expo accepts up to 100 messages per request and rejects the whole batch if
 * you exceed it — so this is a hard limit, not a tuning knob.
 */
const MAX_MESSAGES_PER_REQUEST = 100;

/** One message, in the shape Expo's API takes. */
export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: { url: string };
  sound: 'default';
}

/** One entry from Expo's response, index-aligned with the messages sent. */
export interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface SendOutcome {
  /** Accepted by Expo for delivery. */
  delivered: number;
  /** Rejected. Includes the retired ones — they were still a failed send. */
  failed: number;
  /** Tokens Expo says no longer address a device. Delete these. */
  retire: string[];
}

/**
 * The one error that means the address is dead rather than the send being bad.
 *
 * The others Expo returns — `MessageTooBig`, `MessageRateExceeded`,
 * `MismatchSenderId`, `InvalidCredentials` — are all faults in *this* system or
 * transient, and retiring a token on any of them would delete a working
 * device's address because a payload was oversized once.
 */
const TOKEN_IS_DEAD = 'DeviceNotRegistered';

export function toExpoMessages(tokens: string[], content: NotificationContent): ExpoPushMessage[] {
  return tokens.map((to) => ({
    to,
    title: content.title,
    body: content.body,
    data: { url: content.url },
    // A recall is worth a sound. See `configureNotificationHandler` for the
    // matching decision on the receiving side — shown in the foreground too,
    // because this is not a chat message arriving every few seconds.
    sound: 'default' as const,
  }));
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Read one batch's tickets against the messages that produced them.
 *
 * Pure, and separate from the request for exactly that reason: every
 * interesting behaviour here — which errors retire a token, what happens when
 * Expo returns fewer tickets than messages — is reachable without a network.
 *
 * **A short ticket array counts as failure, not success.** Expo returns one
 * ticket per message; if it ever returns fewer, the messages past the end were
 * not acknowledged by anything, and treating an absent ticket as an accepted
 * send would report a delivery that nobody promised.
 */
export function interpretTickets(
  messages: ExpoPushMessage[],
  tickets: ExpoPushTicket[]
): SendOutcome {
  const outcome: SendOutcome = { delivered: 0, failed: 0, retire: [] };

  messages.forEach((message, index) => {
    const ticket = tickets[index];

    if (!ticket) {
      outcome.failed += 1;
      return;
    }

    if (ticket.status === 'ok') {
      outcome.delivered += 1;
      return;
    }

    outcome.failed += 1;
    if (ticket.details?.error === TOKEN_IS_DEAD) outcome.retire.push(message.to);
  });

  return outcome;
}

/**
 * Hand a set of messages to Expo, in batches, and report what came back.
 *
 * **A failed batch does not abort the rest.** A fan-out is per-device; one
 * request failing because Expo returned a 502 must not silently drop the
 * notification for every device in a later batch. Each batch's failure is
 * counted and the loop continues.
 */
export async function deliver(messages: ExpoPushMessage[]): Promise<SendOutcome> {
  const total: SendOutcome = { delivered: 0, failed: 0, retire: [] };

  for (const batch of chunk(messages, MAX_MESSAGES_PER_REQUEST)) {
    try {
      const response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(batch),
      });

      if (!response.ok) {
        logger.warn('PUSH:SEND', 'Expo rejected a batch', {
          status: response.status,
          size: batch.length,
        });
        total.failed += batch.length;
        continue;
      }

      const payload = (await response.json()) as { data?: ExpoPushTicket[] };
      const outcome = interpretTickets(batch, payload.data ?? []);

      total.delivered += outcome.delivered;
      total.failed += outcome.failed;
      total.retire.push(...outcome.retire);
    } catch (error) {
      // Network, DNS, timeout. Same posture as a rejected batch: count it and
      // carry on, because the batches after this one are unrelated devices.
      logger.error('PUSH:SEND', error instanceof Error ? error : new Error(String(error)), {
        stage: 'Batch failed to reach Expo',
        size: batch.length,
      });
      total.failed += batch.length;
    }
  }

  return total;
}

/**
 * Delete the addresses Expo says are gone.
 *
 * Filtered on the token rather than on an id, because that is what a ticket
 * gives back. The service-role client bypasses RLS, so this deletes across
 * accounts by design — a token is unique to a device, and if two rows somehow
 * hold the same dead token both of them are dead.
 */
export async function retireTokens(tokens: string[]): Promise<number> {
  if (tokens.length === 0) return 0;

  const unique = Array.from(new Set(tokens));

  const { error, count } = await getServiceRoleClient()
    .from('device_push_tokens')
    .delete({ count: 'exact' })
    .in('expo_push_token', unique);

  if (error) {
    // Not fatal. The notification was already sent; a token that survives one
    // sweep is retried next time rather than lost.
    logger.warn('PUSH:SEND', 'Could not retire dead tokens', {
      attempted: unique.length,
      error: error.message,
    });
    return 0;
  }

  logger.info('PUSH:SEND', 'Retired dead push tokens', { retired: count ?? unique.length });
  return count ?? unique.length;
}

/**
 * Send one notification to every device an account has registered.
 *
 * The whole helper, end to end: addresses in, tickets read, dead rows removed.
 *
 * **An account with no registered device is not an error.** Most accounts will
 * not have one — the web app is the majority surface and registers nothing — so
 * a caller iterating vehicles must not treat a zero here as a failed send.
 */
export async function sendToAccount(
  userId: string,
  content: NotificationContent
): Promise<SendOutcome> {
  const { data, error } = await getServiceRoleClient()
    .from('device_push_tokens')
    .select('expo_push_token')
    .eq('user_id', userId);

  if (error) {
    logger.error('PUSH:SEND', new Error(error.message), {
      stage: 'Could not read push tokens',
      userId,
    });
    return { delivered: 0, failed: 0, retire: [] };
  }

  const tokens = (data ?? []).map((row) => row.expo_push_token as string).filter(Boolean);
  if (tokens.length === 0) return { delivered: 0, failed: 0, retire: [] };

  const outcome = await deliver(toExpoMessages(tokens, content));
  await retireTokens(outcome.retire);

  return outcome;
}
