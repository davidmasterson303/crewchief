import { logger } from '@wellkept/core/logger';

/**
 * Read a vehicle's `nhtsa_data` row, tolerating a database that has not had the
 * migration yet.
 *
 * ── ⚠ The read side of a lag the write side already handled ─────────────────
 *
 * `writeNhtsaRow` in `lib/vehicle-research.ts` carries the same fallback and
 * states the rule: **`CLAUDE.md` §2 — the database and the migrations folder
 * disagree, both ways.** `lookup_status` arrives in migration
 * `20260824100000`, and the deploy carrying code that names it can reach
 * production before anybody runs it in the SQL editor.
 *
 * The write path was made resilient. The reads were not, and the column is
 * **not applied**: PostgREST answers `42703` for it today. Because it names
 * the column in its `select`, the *whole query* is rejected — so this was not
 * a missing flag, it was a missing row:
 *
 *   - `data.nhtsa` resolved to `null` on every vehicle dashboard, so the
 *     **recall alert banner never rendered for any car**, including the seeded
 *     M3 whose row holds two open campaigns;
 *   - the recalls driver reported "Recalls have not been checked for this
 *     vehicle" about every vehicle in the product;
 *   - and the hero's caption could never count a recall campaign.
 *
 * None of it errored. The page rendered perfectly with a fact missing from it,
 * which is the failure mode `CLAUDE.md` §6 is about — and it was found by a
 * design critique noticing that two sentences on one screen contradicted each
 * other, not by anything that was watching.
 *
 * ⚠ Deliberately loud and deliberately temporary. Delete the fallback the day
 * the migration is confirmed applied — and confirm it by querying, not by
 * looking at the migrations folder.
 */
export interface NhtsaRow {
  /*
    `any[]` rather than `unknown[]`: NHTSA's campaign objects are consumed all
    over this codebase as loosely-typed records, and narrowing here would only
    push a cast to every call site. `normaliseRecalls` in core is where the
    shape actually gets pinned.
  */
  recalls?: any[] | null;
  lookup_status?: string | null;
  /* Asked for by the sweep through `extraColumns`; typed here so it does not
     arrive as `unknown` via the index signature. */
  next_check_due?: string | null;
  [key: string]: unknown;
}

/** The columns every caller wants, plus whichever extras it asks for. */
export async function selectNhtsaRow(
  /*
    Untyped on purpose: this is called from a client component holding the
    browser client and from server code holding the service-role one. Those are
    different generic instantiations of the same builder, and spelling out a
    structural type for it produced `TS2589: type instantiation is excessively
    deep` rather than any safety.
  */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  vehicleId: string,
  extraColumns: string[] = []
): Promise<NhtsaRow | null> {
  const base = ['recalls', ...extraColumns];

  const withStatus = await client
    .from('nhtsa_data')
    .select([...base, 'lookup_status'].join(','))
    .eq('vehicle_id', vehicleId)
    .maybeSingle();

  if (!withStatus.error) return (withStatus.data as NhtsaRow | null) ?? null;

  if (withStatus.error.code !== '42703') return null;

  logger.error(
    'NHTSA:SCHEMA_LAG',
    new Error('nhtsa_data.lookup_status is missing — run migration 20260824100000'),
    { vehicleId }
  );

  /*
    Without the column the row still carries the recalls, and `recallsAreKnown`
    reads a non-empty array as proof the check happened. So the degraded read
    loses the ability to distinguish "checked, nothing found" from "never
    checked" — which is exactly what the migration is for — while keeping every
    recall that was actually found. Losing the flag is a known limitation;
    losing the row was an outage nobody saw.
  */
  const retry = await client
    .from('nhtsa_data')
    .select(base.join(','))
    .eq('vehicle_id', vehicleId)
    .maybeSingle();

  return retry.error ? null : ((retry.data as NhtsaRow | null) ?? null);
}
