import { logger } from '@crewchief/core/logger';
import { recallNotification, type NotificationContent } from '@crewchief/core/notifications';
import { normaliseRecalls, type NormalisedRecall, type RecallSeverity } from '@crewchief/core/recalls';
import { sendToAccount } from '@/lib/push-send';
import { getServiceRoleClient } from '@/lib/supabase';

/**
 * Deciding that a notification is warranted, and sending it.
 *
 * The piece that joins everything else: `recalls.ts` says what a notice means,
 * `notifications.ts` says what it reads like, `push-send.ts` delivers it, and
 * `recall_notifications` remembers what has already been said. None of them
 * talked to each other until this.
 *
 * ── Why "what did we already say" is a table read and not a timestamp ───────
 *
 * See the migration's header at length. Short version: comparing against
 * `nhtsa_data.last_checked` needs no new schema and silently drops a notice
 * whenever a send fails between the two writes. A row written *after* a
 * successful send cannot.
 *
 * ── Why a severity upgrade re-notifies ──────────────────────────────────────
 *
 * NHTSA revises. A recall issued as ordinary can be upgraded to `parkIt` — do
 * not drive — weeks later, under the same campaign number. Deduplicating on the
 * campaign alone would mean the most urgent notice this product can send is
 * exactly the one it stays silent about, because it already mentioned that
 * campaign in a calmer tone. So the stored severity is compared too, and an
 * escalation is a new notification.
 *
 * De-escalation is not. NHTSA softening a notice is not worth a push.
 */

/** Ranked so an upgrade can be detected without a table of comparisons. */
const SEVERITY_RANK: Record<RecallSeverity, number> = {
  standard: 0,
  'park-outside': 1,
  'do-not-drive': 2,
};

export interface RecallNotice {
  vehicleId: string;
  campaignNumber: string;
  severity: RecallSeverity;
  content: NotificationContent;
}

interface AlreadyRaised {
  campaign_number: string;
  severity: RecallSeverity;
}

/**
 * Which of this vehicle's recalls are worth raising right now.
 *
 * Pure, and separate from the sending for that reason: every interesting rule —
 * what counts as new, what counts as an escalation, what a recall with no
 * campaign number does — is reachable without a database or a network.
 *
 * **A recall with no campaign number is skipped, not raised.** It cannot be
 * deduplicated, so raising it means raising it again on every single poll. A
 * notice nobody can silence is worse than one nobody receives.
 */
export function recallsWorthRaising(params: {
  vehicleId: string;
  vehicleName: string;
  recalls: NormalisedRecall[];
  alreadyRaised: AlreadyRaised[];
}): RecallNotice[] {
  const { vehicleId, vehicleName, recalls, alreadyRaised } = params;

  const seen = new Map(alreadyRaised.map((row) => [row.campaign_number, row.severity]));

  return recalls
    .filter((recall) => recall.campaignNumber !== null)
    .filter((recall) => {
      const previous = seen.get(recall.campaignNumber!);

      if (previous === undefined) return true;

      // Upgraded since we last spoke. De-escalation deliberately does not fire.
      return SEVERITY_RANK[recall.severity] > (SEVERITY_RANK[previous] ?? 0);
    })
    .map((recall) => ({
      vehicleId,
      campaignNumber: recall.campaignNumber!,
      severity: recall.severity,
      content: recallNotification({
        vehicleId,
        vehicleName,
        recallSummary: recall.summary ?? recall.component ?? 'A recall has been issued.',
      }),
    }));
}

/**
 * Evaluate one vehicle and send whatever it turns out to need.
 *
 * **Recorded only after the send reports a delivery.** If Expo accepted nothing
 * — every token dead, the service down, the account holding no registered
 * device — the notice stays unraised and the next poll tries again. Writing the
 * row on intent rather than outcome is how a recall gets silently swallowed by
 * one bad afternoon.
 *
 * The exception is an account with no devices at all: there is nothing to
 * deliver to and nothing to retry, so it is not an error and not recorded
 * either. When that owner installs the app, they get the notice.
 */
export async function runRecallTriggerForVehicle(vehicle: {
  id: string;
  user_id: string;
  year: number | null;
  make: string | null;
  model: string | null;
}): Promise<{ raised: number; skipped: number }> {
  const client = getServiceRoleClient();
  const name = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'your vehicle';

  const { data: nhtsa, error: nhtsaError } = await client
    .from('nhtsa_data')
    .select('recalls')
    .eq('vehicle_id', vehicle.id)
    .maybeSingle();

  if (nhtsaError) {
    logger.error('NOTIFY:RECALL', new Error(nhtsaError.message), { vehicleId: vehicle.id });
    return { raised: 0, skipped: 0 };
  }

  const recalls = normaliseRecalls(nhtsa?.recalls);
  if (recalls.length === 0) return { raised: 0, skipped: 0 };

  const { data: alreadyRaised, error: raisedError } = await client
    .from('recall_notifications')
    .select('campaign_number,severity')
    .eq('vehicle_id', vehicle.id);

  if (raisedError) {
    /*
      Refuse rather than proceed. Not knowing what has already been said and
      sending anyway is how every recall on the car arrives again — the exact
      failure the table exists to prevent, reached by ignoring the table.
    */
    logger.error('NOTIFY:RECALL', new Error(raisedError.message), {
      vehicleId: vehicle.id,
      stage: 'Could not read what was already raised — sending nothing',
    });
    return { raised: 0, skipped: recalls.length };
  }

  const notices = recallsWorthRaising({
    vehicleId: vehicle.id,
    vehicleName: name,
    recalls,
    alreadyRaised: (alreadyRaised ?? []) as AlreadyRaised[],
  });

  let raised = 0;

  for (const notice of notices) {
    const outcome = await sendToAccount(vehicle.user_id, notice.content);

    if (outcome.delivered === 0) {
      // Nothing reached a device. Leave it unrecorded so the next poll retries.
      continue;
    }

    const { error: writeError } = await client.from('recall_notifications').upsert(
      {
        vehicle_id: notice.vehicleId,
        campaign_number: notice.campaignNumber,
        severity: notice.severity,
        notified_at: new Date().toISOString(),
      },
      { onConflict: 'vehicle_id,campaign_number' }
    );

    if (writeError) {
      /*
        Delivered but not recorded. The owner will get this one again on the
        next poll, which is the right direction to fail in — a duplicate recall
        notice is an annoyance, a suppressed one is a safety problem.
      */
      logger.error('NOTIFY:RECALL', new Error(writeError.message), {
        vehicleId: vehicle.id,
        campaignNumber: notice.campaignNumber,
        stage: 'Delivered but not recorded — will re-raise',
      });
    }

    raised++;
  }

  if (raised > 0) {
    logger.info('NOTIFY:RECALL', 'Raised recall notices', { vehicleId: vehicle.id, raised });
  }

  return { raised, skipped: notices.length - raised };
}

/**
 * Every vehicle whose owner has a device that could receive a notification.
 *
 * Scoped by registered device rather than by vehicle, because the alternative
 * reads NHTSA data for every car in the product to decide it has nowhere to
 * send. Most accounts have no device — the web app registers none — so this is
 * the difference between a poll that scales with the product and one that
 * scales with the fleet.
 */
export async function vehiclesWithNotifiableOwners(): Promise<
  Array<{ id: string; user_id: string; year: number | null; make: string | null; model: string | null }>
> {
  const client = getServiceRoleClient();

  const { data: tokens, error: tokenError } = await client
    .from('device_push_tokens')
    .select('user_id');

  if (tokenError) {
    logger.error('NOTIFY:RECALL', new Error(tokenError.message), { stage: 'Reading push tokens' });
    return [];
  }

  const userIds = Array.from(new Set((tokens ?? []).map((row) => row.user_id as string)));
  if (userIds.length === 0) return [];

  const { data: vehicles, error: vehicleError } = await client
    .from('vehicles')
    .select('id,user_id,year,make,model')
    .in('user_id', userIds);

  if (vehicleError) {
    logger.error('NOTIFY:RECALL', new Error(vehicleError.message), { stage: 'Reading vehicles' });
    return [];
  }

  return (vehicles ?? []) as Array<{
    id: string;
    user_id: string;
    year: number | null;
    make: string | null;
    model: string | null;
  }>;
}
