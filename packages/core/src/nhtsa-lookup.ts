/**
 * What an NHTSA recall lookup actually concluded.
 *
 * ── ⚠ The defect this exists to make impossible (FN-03, 24 Aug) ─────────────
 *
 * `recallsByVehicle` matches on NHTSA's own controlled vocabulary. A make or
 * model it does not recognise returns **HTTP 200 with `{"Count": 0, "results":
 * []}`** — byte-identical to a genuinely clean vehicle.
 *
 * Both were stored as `recalls: []`, and the screen then derived "we checked"
 * from the row existing. So typing **"Chevy"** instead of **"CHEVROLET"** gave
 * a 2014 Silverado a green tick and the words *"No active recalls"* while its
 * real open campaigns were never raised. Same for "Dodge Ram", any accented
 * marque, and any model containing a slash. The vehicle strings are
 * user-supplied and were never validated.
 *
 * This is `health-claims.ts`'s Takata defect one table over: **absence rendered
 * as an all-clear, on a safety claim.** The difference is that here the absence
 * is indistinguishable after the fact — `[]` is the same bytes either way — so
 * the outcome has to be recorded by the code that made the call, at the moment
 * it is known.
 *
 * ── Why the vocabulary check is a second request and worth it ───────────────
 *
 * `GetModelsForMakeYear` is NHTSA's own list of models for a make and year. If
 * it returns nothing, the make is not one NHTSA knows and a zero-recall answer
 * for it means nothing. One extra request per *research run* — not per page
 * view — against a free API, to avoid telling somebody their truck is clear.
 */

export type NhtsaLookupStatus = 'matched' | 'no_match' | 'failed' | 'unknown';

export interface NhtsaLookup {
  status: NhtsaLookupStatus;
  /** Empty unless `status === 'matched'`. Never trusted otherwise. */
  recalls: unknown[];
}

/**
 * Whether a stored lookup permits saying "no recalls".
 *
 * ⚠ **The one function every caller must route through**, rather than each
 * deciding for itself. `recallsChecked = Boolean(nhtsaRow)` was the original
 * spelling of this question and it answered a different one — "did we write a
 * row" instead of "did we learn anything".
 */
export function recallsWereChecked(status: string | null | undefined): boolean {
  return status === 'matched';
}

/**
 * How NHTSA's own response should be read.
 *
 * ⚠ `matched` requires **either** a recall to have come back, **or** the make
 * to have been independently confirmed as one NHTSA knows. A bare zero with no
 * confirmation is `no_match`, because that is the case this module exists for
 * and the two are identical on the wire.
 */
export function readRecallResponse({
  ok,
  results,
  makeIsKnown,
}: {
  /** The HTTP response succeeded. */
  ok: boolean;
  /** `data.results`, whatever arrived — validated here rather than by the caller. */
  results: unknown;
  /**
   * `GetModelsForMakeYear` recognised the make. `null` when the check could not
   * be run, which is **not** the same as it having failed — see below.
   */
  makeIsKnown: boolean | null;
}): NhtsaLookup {
  if (!ok) return { status: 'failed', recalls: [] };

  const recalls = Array.isArray(results) ? results : [];

  /*
    A recall came back, so NHTSA plainly recognises this vehicle. The vocabulary
    check is redundant here and its answer is ignored — including when it failed,
    which is the case where insisting on it would throw away a real finding.
  */
  if (recalls.length > 0) return { status: 'matched', recalls };

  /*
    ⚠ Zero recalls. This is the fork, and the honest default is the pessimistic
    one: `null` — the vocabulary check did not run or could not answer — reads as
    `no_match`, not as `matched`. Erring the other way would restore the exact
    all-clear this module was written to remove, on the strength of a *second*
    request having failed.
  */
  return makeIsKnown === true
    ? { status: 'matched', recalls: [] }
    : { status: 'no_match', recalls: [] };
}

/**
 * When the next check is due.
 *
 * Ninety days for a lookup that worked. **A day** for one that did not, because
 * `no_match` and `failed` are states to get *out* of — a car whose make was
 * mistyped should be re-checked as soon as the owner corrects it, not next
 * quarter.
 */
export function nextCheckDue(status: NhtsaLookupStatus, now = new Date()): string {
  const days = status === 'matched' ? 90 : 1;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}
