/**
 * The only writer of `account_entitlements`.
 *
 * @jest-environment node
 *
 * Phase 6, E8. The *decisions* are tested in `apple-subscription.test.ts`
 * against the pure state machine; what is tested here is the part that can only
 * go wrong against a database — the deploy window where the migration has not
 * been applied, and the shape of what actually gets written.
 */

import type { AppleSubscriptionEvent } from '@wellkept/core/apple-subscription';

const maybeSingle = jest.fn();
const upsert = jest.fn();
const select = jest.fn();

jest.mock('@/lib/supabase', () => ({
  getServiceRoleClient: () => ({
    from: () => ({
      select: (cols: string) => {
        select(cols);
        return { eq: () => ({ maybeSingle }) };
      },
      upsert: (row: unknown, opts: unknown) => upsert(row, opts),
    }),
  }),
}));

const { applyVerifiedAppleEvent } = require('@/lib/entitlement-store');

const USER = '11111111-2222-3333-4444-555555555555';
const MONTHLY = 'co.davidmasterson.crewchief.paid.monthly';

function event(over: Partial<AppleSubscriptionEvent> = {}): AppleSubscriptionEvent {
  return {
    notificationType: 'DID_RENEW',
    signedDate: Date.parse('2026-08-18T10:00:00Z'),
    originalTransactionId: '2000000000000001',
    productId: MONTHLY,
    transactionId: '2000000000000009',
    expiresDate: Date.parse('2026-09-18T10:00:00Z'),
    environment: 'Production',
    ...over,
  };
}

beforeEach(() => {
  maybeSingle.mockReset();
  upsert.mockReset();
  select.mockReset();
  maybeSingle.mockResolvedValue({ data: null, error: null });
  upsert.mockResolvedValue({ error: null });
});

describe('the window where the migration has not been applied', () => {
  it('refuses to write rather than degrading, when the read reports 42703', async () => {
    /*
      The tempting alternative is to write what fits and skip the rest. That is
      wrong specifically because of `last_signed_date`: without it there is no
      ordering guard, Apple does not deliver in order, and a "successful"
      degraded write is an entitlement a late retry can silently rewind.
    */
    maybeSingle.mockResolvedValue({
      data: null,
      error: { code: '42703', message: 'column "last_signed_date" does not exist' },
    });

    const result = await applyVerifiedAppleEvent(USER, event());

    expect(result).toMatchObject({ ok: false, reason: 'schema-not-ready' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('refuses on PostgREST’s own unknown-column code too', async () => {
    // Two codes mean the same thing from different layers; only one is Postgres'.
    maybeSingle.mockResolvedValue({
      data: null,
      error: { code: 'PGRST204', message: 'column not found in schema cache' },
    });

    expect(await applyVerifiedAppleEvent(USER, event())).toMatchObject({
      ok: false,
      reason: 'schema-not-ready',
    });
  });

  it('refuses when the write is the thing that discovers the missing column', async () => {
    // The read can succeed against a cached schema and the write still fail.
    upsert.mockResolvedValue({ code: '42703', error: { code: '42703', message: 'no column' } });

    expect(await applyVerifiedAppleEvent(USER, event())).toMatchObject({
      ok: false,
      reason: 'schema-not-ready',
    });
  });

  it('does not mistake an ordinary read failure for a missing migration', async () => {
    /*
      Anti-vacuous in the direction that matters: if every error resolved to
      `schema-not-ready`, the refusal above would prove nothing and a real
      outage would be reported as a pending migration forever.
    */
    maybeSingle.mockResolvedValue({
      data: null,
      error: { code: '57014', message: 'statement timeout' },
    });

    expect(await applyVerifiedAppleEvent(USER, event())).toMatchObject({
      ok: false,
      reason: 'read-failed',
    });
  });
});

describe('what actually reaches the table', () => {
  it('upserts the full record on the user_id conflict target', async () => {
    const result = await applyVerifiedAppleEvent(USER, event({ notificationType: 'SUBSCRIBED' }));

    expect(result).toMatchObject({ ok: true, applied: true, tier: 'paid' });

    const [row, opts] = upsert.mock.calls[0];
    expect(opts).toEqual({ onConflict: 'user_id' });
    expect(row).toMatchObject({
      user_id: USER,
      tier: 'paid',
      product_id: MONTHLY,
      original_transaction_id: '2000000000000001',
      environment: 'Production',
      expires_at: '2026-09-18T10:00:00.000Z',
      last_signed_date: '2026-08-18T10:00:00.000Z',
      revoked_at: null,
    });
  });

  it('reads every column the decision needs, or the ordering guard is blind', () => {
    /*
      A SELECT that omits `last_signed_date` would hand the state machine a null
      for it, which reads as "no previous event" and disables replay protection
      — silently, and only in production where events actually repeat.
    */
    return applyVerifiedAppleEvent(USER, event()).then(() => {
      const cols = select.mock.calls[0][0];
      for (const needed of [
        'tier',
        'expires_at',
        'original_transaction_id',
        'environment',
        'revoked_at',
        'last_signed_date',
      ]) {
        expect(`${needed}:${cols.includes(needed)}`).toBe(`${needed}:true`);
      }
    });
  });

  it('writes nothing when the decision layer says the event is stale', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        user_id: USER,
        tier: 'paid',
        expires_at: '2026-09-18T10:00:00.000Z',
        original_transaction_id: '2000000000000001',
        product_id: MONTHLY,
        environment: 'Production',
        auto_renew_status: true,
        revoked_at: null,
        latest_transaction_id: '2000000000000008',
        // Newer than the incoming event, so the event is a late retry.
        last_signed_date: '2026-08-18T11:00:00.000Z',
      },
      error: null,
    });

    const result = await applyVerifiedAppleEvent(USER, event());

    expect(result).toMatchObject({ ok: true, applied: false, reason: 'stale-event' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('reports a write failure rather than claiming the entitlement moved', async () => {
    upsert.mockResolvedValue({ error: { code: '23503', message: 'fk violation' } });

    expect(await applyVerifiedAppleEvent(USER, event())).toMatchObject({
      ok: false,
      reason: 'write-failed',
    });
  });
});
