/**
 * A recall lookup that found nothing is not a car with no recalls.
 *
 * @jest-environment node
 *
 * ── The defect, from the 24 Aug audit (FN-03) ───────────────────────────────
 *
 * `recallsByVehicle` matches on NHTSA's controlled vocabulary. A make it does
 * not recognise returns **HTTP 200 with `{"Count": 0, "results": []}`** —
 * byte-identical to a genuinely clean vehicle. Both were stored as
 * `recalls: []`, and the screen derived "we checked" from the row existing.
 *
 * Type **"Chevy"** instead of **"CHEVROLET"** and a 2014 Silverado showed a
 * green tick and *"No active recalls"* while its real open campaigns were never
 * raised. The vehicle strings are user-supplied and were never validated.
 *
 * This is `health-claims.ts`'s Takata defect one table over, with the extra
 * cruelty that the two cases are indistinguishable after the fact.
 */

import {
  nextCheckDue,
  readRecallResponse,
  recallsWereChecked,
  recallsAreKnown,} from '@wellkept/core/nhtsa-lookup';
import { recallsToRefresh, SWEEP_RECALL_REFRESH_CAP } from '@wellkept/core/notification-sweep';

describe('readRecallResponse', () => {
  it('trusts a zero only when the make was independently confirmed', () => {
    expect(readRecallResponse({ ok: true, results: [], makeIsKnown: true }).status).toBe('matched');
  });

  it('refuses a zero for a make NHTSA does not know — the "Chevy" case', () => {
    /*
      ⚠ The whole finding. Same status code, same body, same empty array — and
      one of these cars has open campaigns.
    */
    const lookup = readRecallResponse({ ok: true, results: [], makeIsKnown: false });

    expect(lookup.status).toBe('no_match');
    expect(recallsWereChecked(lookup.status)).toBe(false);
  });

  it('refuses a zero when the vocabulary check could not answer', () => {
    /*
      ⚠ `null` is not `false`, and the honest default is the pessimistic one. A
      *second* request failing must not be what grants a clean bill.
    */
    expect(readRecallResponse({ ok: true, results: [], makeIsKnown: null }).status).toBe('no_match');
  });

  it('trusts a recall that came back, whatever the vocabulary check said', () => {
    /*
      NHTSA plainly recognises a vehicle it just returned a campaign for.
      Insisting on the second check here would throw away a real finding
      because a redundant request failed.
    */
    const lookup = readRecallResponse({
      ok: true,
      results: [{ NHTSACampaignNumber: '21V123' }],
      makeIsKnown: null,
    });

    expect(lookup.status).toBe('matched');
    expect(lookup.recalls).toHaveLength(1);
  });

  it('reports a non-200 as failed, and carries no recalls out of it', () => {
    const lookup = readRecallResponse({ ok: false, results: null, makeIsKnown: true });

    expect(lookup.status).toBe('failed');
    expect(lookup.recalls).toEqual([]);
    expect(recallsWereChecked(lookup.status)).toBe(false);
  });

  it('survives a body that is not the shape it claims', () => {
    expect(readRecallResponse({ ok: true, results: 'nope', makeIsKnown: true }).recalls).toEqual([]);
  });
});

describe('recallsWereChecked', () => {
  it('is true for exactly one status', () => {
    expect(recallsWereChecked('matched')).toBe(true);

    for (const status of ['no_match', 'failed', 'unknown', null, undefined, '']) {
      expect([status, recallsWereChecked(status)]).toEqual([status, false]);
    }
  });
});

describe('nextCheckDue', () => {
  it('comes back tomorrow for a lookup that did not resolve', () => {
    /*
      `no_match` and `failed` are states to get *out* of — a car whose make was
      mistyped should be re-checked as soon as the owner corrects it, not next
      quarter.
    */
    const now = new Date('2026-08-24T00:00:00Z');

    expect(nextCheckDue('no_match', now)).toBe('2026-08-25T00:00:00.000Z');
    expect(nextCheckDue('failed', now)).toBe('2026-08-25T00:00:00.000Z');
    expect(nextCheckDue('matched', now)).toBe('2026-11-22T00:00:00.000Z');
  });
});

describe('recallsToRefresh — FN-02', () => {
  const car = (lookupStatus: string | null, nextCheckDue: string | null) => ({
    lookupStatus,
    nextCheckDue,
  });

  const NOW = new Date('2026-08-24T00:00:00Z');

  it('leaves a fresh matched lookup alone', () => {
    const plan = recallsToRefresh([car('matched', '2026-11-01T00:00:00Z')], NOW);

    expect(plan.send).toEqual([]);
  });

  it('re-fetches a matched lookup that is past due', () => {
    /*
      ⚠ The finding in one case. Recalls were fetched **once per vehicle, ever**
      — `.insert()` against a UNIQUE column raising `23505` into a variable
      nobody read — so a WRX added in February kept its green tick after NHTSA
      opened a campaign in April.
    */
    const plan = recallsToRefresh([car('matched', '2026-08-01T00:00:00Z')], NOW);

    expect(plan.send).toHaveLength(1);
  });

  it('always re-fetches a lookup that never resolved', () => {
    // `no_match` and `failed` are wrong answers, not old ones.
    for (const status of ['no_match', 'failed', 'unknown', null]) {
      const plan = recallsToRefresh([car(status, '2099-01-01T00:00:00Z')], NOW);
      expect([status, plan.send.length]).toEqual([status, 1]);
    }
  });

  it('puts the unresolved ones first, then the oldest', () => {
    /*
      A row that never recorded an outcome is the one most likely to be hiding a
      `no_match`, so it goes ahead of one that is merely old.
    */
    const plan = recallsToRefresh(
      [
        car('matched', '2020-01-01T00:00:00Z'),
        car('no_match', '2099-01-01T00:00:00Z'),
        car('matched', '2019-01-01T00:00:00Z'),
      ],
      NOW
    );

    expect(plan.send.map((c) => c.lookupStatus)).toEqual(['no_match', 'matched', 'matched']);
    expect(plan.send[1].nextCheckDue).toBe('2019-01-01T00:00:00Z');
  });

  it('caps the run and says it capped', () => {
    /*
      Not about money — NHTSA is free. About request volume against somebody
      else's service in one burst, and about a sweep that already struggles to
      finish inside a function timeout.
    */
    const many = Array.from({ length: SWEEP_RECALL_REFRESH_CAP + 5 }, () => car('no_match', null));
    const plan = recallsToRefresh(many, NOW);

    expect(plan.send).toHaveLength(SWEEP_RECALL_REFRESH_CAP);
    expect(plan.capped).toBe(true);
    expect(plan.considered).toBe(SWEEP_RECALL_REFRESH_CAP + 5);
  });

  it('re-fetches a row whose due date is unreadable rather than skipping it', () => {
    // A date we cannot parse is not a date in the future.
    expect(recallsToRefresh([car('matched', 'not a date')], NOW).send).toHaveLength(1);
  });
});

describe('recall rows are evidence, an empty array is not', () => {
  /*
    ── ⚠ Why this exists, and it is a fact about production ──────────────────

    `nhtsa_data.lookup_status` is not in the live database. The migration that
    adds it has not been applied — PostgREST answers `42703` — so every read
    resolves to `undefined` and `recallsWereChecked` is `false` for every
    vehicle in the product.

    The visible result on the seeded M3: the dashboard's recalls driver said
    "Recalls have not been checked for this vehicle" directly above the model's
    written status, "2 open recalls — fuel pump and electrical system", because
    `healthClaim` deliberately lets a written finding win. One screen, two
    statements, flatly contradicting each other.
  */
  it('treats a non-empty array as proof the check happened', () => {
    expect(recallsAreKnown(undefined, [{ NHTSACampaignNumber: '21V702000' }])).toBe(true);
    expect(recallsAreKnown(null, [{ NHTSACampaignNumber: '21V702000' }])).toBe(true);
  });

  it('never turns an unproven empty result into an all-clear', () => {
    /*
      The asymmetry is the whole point, and it is the FN-03 case: an
      `nhtsa_data` row is written even for a lookup NHTSA did not recognise, so
      `[]` is byte-identical to a genuinely clean vehicle. Rows prove a match;
      the absence of rows proves nothing without the status.

      ⚠ This is the assertion that fails if someone "simplifies" the function
      to `recalls !== undefined`, which would score every unrecognised truck
      100 and print "No recalls on record" under it.
    */
    expect(recallsAreKnown(undefined, [])).toBe(false);
    expect(recallsAreKnown('no_match', [])).toBe(false);
    expect(recallsAreKnown('failed', [])).toBe(false);
    expect(recallsAreKnown('unknown', undefined)).toBe(false);
  });

  it('still honours a matched status with nothing found', () => {
    // The case the migration exists for, and the one this cannot replace: a
    // vehicle NHTSA genuinely cleared. Only the status can say so.
    expect(recallsAreKnown('matched', [])).toBe(true);
  });
});
