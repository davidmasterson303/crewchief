import { NextRequest, NextResponse } from 'next/server';

import { logger } from '@crewchief/core/logger';
import { authorizeVehicleAccess } from '@/lib/api-auth';
import { getServiceRoleClient } from '@/lib/supabase';
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * What an owner has done about a recall.
 *
 * ── Why this route exists at all ────────────────────────────────────────────
 *
 * The phone could see recalls and could ask the advisor about them, and could
 * do nothing else. A safety notice you cannot ever clear is a notice that stops
 * being read: it sits on the garage chip and the detail banner forever, so
 * after the second week it is furniture rather than information — which is the
 * precise failure mode a permanent red badge has.
 *
 * ⚠ **The storage was already there and already used by the other client.**
 * `recall_actions` has existed since the 14 Mar migration, and `RecallAlerts`
 * on web writes to it from the browser through supabase-js. Mobile cannot do
 * that, and should not: `mobile-api-only.test.ts` forbids a Supabase client on
 * the device, for the reason that file records — a client that talks to tables
 * directly is a second answer to "who may see this", and the second answer is
 * the one that is wrong. So the phone gets a route, and the route is the same
 * authorization every other `/api/v1` path uses.
 *
 * ── ⚠ "Repaired" is the owner's claim, and this route never upgrades it ─────
 *
 * Nothing here verifies anything. NHTSA does not tell us a specific car was
 * fixed — recalls match on **year/make/model, not VIN** (`advice-range.ts`
 * carries that argument, and `CLAUDE.md` §10 makes it a standing rule), so the
 * most this product can honestly hold is *"you told us you had this done, on
 * this date"*.
 *
 * Three consequences, and all three are in the shape of this endpoint rather
 * than in a comment somewhere:
 *
 *   - The row stores `addressed_at`, a **date the owner asserted**, and the
 *     clients render it as such. There is no `verified` column and there must
 *     not be one until something can verify it.
 *   - `DELETE` exists and is a first-class operation, not an admin escape
 *     hatch. A claim someone can make and cannot unmake is a trap, and a
 *     mis-tap on a safety notice is exactly the tap worth being able to undo.
 *   - The recall itself is never deleted or hidden by this route. It returns
 *     *what has been marked*; deciding that a marked recall drops out of the
 *     open count is the client's business, and the notice stays readable.
 *
 * ── The shape, and why GET returns a list rather than a count ───────────────
 *
 * A count would be enough for the garage chip and useless for the recall
 * screen, which has to know **which** campaign was marked and when. Returning
 * the rows lets one request serve both, and it means the chip's number is
 * derived from the same data the detail screen shows rather than from a second
 * number that can disagree with it.
 */

interface AddressedRecall {
  campaignNumber: string;
  /** `YYYY-MM-DD`, as the owner asserted it. Never a verification. */
  addressedAt: string;
}

/**
 * A campaign number, or `null`.
 *
 * ⚠ Bounded and character-checked before it reaches the database. NHTSA's
 * numbers are short (`23V-441`, `PE24-012`), and this string arrives from a
 * client and is written to a `TEXT` column with a `UNIQUE` constraint on it —
 * so an unbounded value is a client choosing how much of our storage one row
 * occupies. The check is deliberately loose about *format*: NHTSA has changed
 * its numbering more than once, and a route that refused a genuine campaign
 * because it did not match a regex would be refusing the safety notice.
 */
function readCampaignNumber(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 40) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(trimmed)) return null;

  return trimmed;
}

function rows(data: unknown): AddressedRecall[] {
  if (!Array.isArray(data)) return [];

  return data.flatMap((row) => {
    const record = row as { campaign_number?: unknown; addressed_at?: unknown };
    if (typeof record.campaign_number !== 'string') return [];

    return [
      {
        campaignNumber: record.campaign_number,
        addressedAt:
          typeof record.addressed_at === 'string'
            ? record.addressed_at
            : /*
                The column is `NOT NULL DEFAULT CURRENT_DATE`, so this branch
                should be unreachable — and it is here rather than as a `!`
                because "should be unreachable" is what every stale docblock in
                this repository said about something. An empty string renders as
                a missing date; a crash renders as a broken recall screen.
              */
              '',
      },
    ];
  });
}

/** Everything this owner has marked on this vehicle. */
export async function GET(request: NextRequest): Promise<Response> {
  const rateLimit = await checkRateLimit(getClientIdentifier(request), 'default');
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  const vehicleId = new URL(request.url).searchParams.get('vehicleId');

  const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
  if (!access.ok) return access.response;

  /*
    The service-role client, matching `wishlist/route.ts` and for the reason
    written there: whether `recall_actions` carries a SELECT policy for an
    authenticated owner is a question about the live database rather than about
    the migrations folder, and reading through the caller's client would trade a
    clear 401 for a silently empty list. Ownership has already been established
    above, through the caller's own client, so RLS did apply to the check that
    matters.

    ⚠ A demo vehicle reaches here with `isDemo` and no user. It has no marks and
    cannot gain any — `intent: 'write'` refuses it below — so it reads as an
    empty list, which is the truth rather than a special case.
  */
  const { data, error } = await getServiceRoleClient()
    .from('recall_actions')
    .select('campaign_number,addressed_at')
    .eq('vehicle_id', vehicleId)
    .order('addressed_at', { ascending: false });

  if (error) {
    logger.error('RECALLS_API:GET', new Error(error.message), { vehicleId });
    return NextResponse.json({ error: 'Failed to read recall history' }, { status: 500 });
  }

  return NextResponse.json({ addressed: rows(data) });
}

/**
 * Mark a recall repaired.
 *
 * An upsert on `(vehicle_id, campaign_number)`, which the table already
 * constrains as unique — so marking the same campaign twice moves the date
 * rather than failing, and a double-tap on a slow connection is not an error
 * anybody has to see.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const rateLimit = await checkRateLimit(getClientIdentifier(request), 'default');
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const vehicleId = typeof body.vehicleId === 'string' ? body.vehicleId : null;
  const campaignNumber = readCampaignNumber(body.campaignNumber);

  const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
  if (!access.ok) return access.response;

  if (!campaignNumber) {
    return NextResponse.json({ error: 'A campaign number is required' }, { status: 400 });
  }

  /*
    The date is **the server's**, not the client's.

    A body-supplied date would let a phone with a wrong clock write "repaired
    in 2019" onto a 2024 campaign, and this is a safety record. If backdating
    ever becomes a feature — "I had this done last spring" is a reasonable thing
    to want to say — it needs its own bounded field and its own argument, not a
    field this route happens to trust.
  */
  const addressedAt = new Date().toISOString().slice(0, 10);

  const { error } = await getServiceRoleClient()
    .from('recall_actions')
    .upsert(
      { vehicle_id: vehicleId, campaign_number: campaignNumber, addressed_at: addressedAt },
      { onConflict: 'vehicle_id,campaign_number' }
    );

  if (error) {
    logger.error('RECALLS_API:POST', new Error(error.message), { vehicleId });
    return NextResponse.json({ error: 'Could not save that' }, { status: 500 });
  }

  logger.info('RECALLS_API:MARKED', 'Recall marked as repaired by its owner', { vehicleId });

  return NextResponse.json({ addressed: { campaignNumber, addressedAt } });
}

/**
 * Undo a mark.
 *
 * ⚠ First-class, not an escape hatch — see the header. The one thing an owner
 * can assert here is a claim about their own car, and a claim that cannot be
 * withdrawn is a trap on the one screen where a mis-tap matters most.
 */
export async function DELETE(request: NextRequest): Promise<Response> {
  const rateLimit = await checkRateLimit(getClientIdentifier(request), 'default');
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  const params = new URL(request.url).searchParams;
  const vehicleId = params.get('vehicleId');
  const campaignNumber = readCampaignNumber(params.get('campaignNumber'));

  const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
  if (!access.ok) return access.response;

  if (!campaignNumber) {
    return NextResponse.json({ error: 'A campaign number is required' }, { status: 400 });
  }

  const { error } = await getServiceRoleClient()
    .from('recall_actions')
    .delete()
    .eq('vehicle_id', vehicleId)
    .eq('campaign_number', campaignNumber);

  if (error) {
    logger.error('RECALLS_API:DELETE', new Error(error.message), { vehicleId });
    return NextResponse.json({ error: 'Could not undo that' }, { status: 500 });
  }

  return NextResponse.json({ removed: campaignNumber });
}
