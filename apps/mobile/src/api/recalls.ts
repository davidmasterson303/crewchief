import { apiRequest } from './client';

/**
 * What the owner has said they have done about a recall.
 *
 * ── ⚠ This is a claim, and every name in this file is chosen to keep it one ─
 *
 * Not `fixed`, not `resolved`, not `complete`. **`addressed`**, with the date
 * the owner asserted it — because nothing in this product can verify that a
 * specific car was repaired. Recalls match on **year/make/model, not VIN**
 * (`advice-range.ts` carries the argument, `CLAUDE.md` §10 makes it standing
 * policy), so a stronger word here would be the product claiming knowledge it
 * does not have about a safety defect, which is the worst available place to
 * do it.
 *
 * The screen reads this back as *"You marked this repaired on 23 Aug"* rather
 * than *"Repaired"*, and that sentence is the reason the field is a date rather
 * than a boolean.
 */
export interface AddressedRecall {
  campaignNumber: string;
  /** `YYYY-MM-DD`. What the owner said, when they said it. */
  addressedAt: string;
}

/**
 * Everything marked on one vehicle.
 *
 * Throws like every other call in this app — `ApiRequestError` carries the
 * status, and the two screens that use this treat a failure as "we could not
 * check" rather than as "nothing is marked". Those are different, and defaulting
 * to the second would show a cleared recall as open again, which reads as the
 * app forgetting.
 */
export async function fetchAddressedRecalls(vehicleId: string): Promise<AddressedRecall[]> {
  const body = await apiRequest<{ addressed?: AddressedRecall[] }>(
    `/recalls?vehicleId=${encodeURIComponent(vehicleId)}`
  );

  return body.addressed ?? [];
}

/** Record that the owner had this campaign seen to. The server sets the date. */
export async function markRecallAddressed(
  vehicleId: string,
  campaignNumber: string
): Promise<AddressedRecall> {
  const body = await apiRequest<{ addressed?: AddressedRecall }>('/recalls', {
    method: 'POST',
    body: { vehicleId, campaignNumber },
  });

  if (!body.addressed) throw new Error('That was not saved.');
  return body.addressed;
}

/**
 * Take the mark back.
 *
 * A first-class operation, not an escape hatch. The route's docblock carries
 * why: an assertion somebody can make and cannot unmake is a trap, and a
 * mis-tap on a safety notice is the one most worth being able to undo.
 */
export async function unmarkRecallAddressed(
  vehicleId: string,
  campaignNumber: string
): Promise<void> {
  await apiRequest(
    `/recalls?vehicleId=${encodeURIComponent(vehicleId)}` +
      `&campaignNumber=${encodeURIComponent(campaignNumber)}`,
    { method: 'DELETE' }
  );
}
