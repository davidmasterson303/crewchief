/**
 * The webhook's status codes, which are a control signal rather than a report.
 *
 * @jest-environment node
 *
 * Phase 6, E8. Apple retries every non-2xx for up to three days with backoff,
 * so the code this route returns decides whether a notification is redelivered.
 * Getting one wrong is not cosmetic: a 5xx on something a retry cannot fix
 * wastes three days of redelivery and then drops it, and a 2xx on something a
 * retry *would* have fixed drops it immediately.
 *
 * The signatures are real — the same throwaway PKI the other E8 suites use —
 * because the 401 path is the one that must not be mockable into passing.
 */

import { createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = join(__dirname, 'fixtures', 'apple-jws');
const read = (f: string) => readFileSync(join(FIXTURES, f), 'utf8');
const CHAIN = [read('leaf.crt'), read('inter.crt'), read('root.crt')];
const KEY = read('leaf.key');
const ROGUE_CHAIN = [read('rogueleaf.crt'), read('rogue.crt')];
const ROGUE_KEY = read('rogueleaf.key');

const applyVerifiedAppleEvent = jest.fn();
const findUserByOriginalTransactionId = jest.fn();

jest.mock('@/lib/entitlement-store', () => ({
  applyVerifiedAppleEvent: (...a: unknown[]) => applyVerifiedAppleEvent(...a),
  findUserByOriginalTransactionId: (...a: unknown[]) => findUserByOriginalTransactionId(...a),
}));

/*
  The route anchors on the real Apple root. These tests sign with the test PKI,
  so the anchor is swapped for the test root — the *verification* is genuine,
  only the authority differs. Swapping it for `[]` would make every payload
  fail and the 401 test would prove nothing.
*/
jest.mock('@/lib/apple-root-ca', () => ({
  getAppleRootCertificates: () => [readFileSync(join(FIXTURES, 'root.crt'), 'utf8')],
}));

const { POST } = require('@/app/api/internal/apple-notifications/route');

const b64u = (b: Buffer | string) => Buffer.from(b as never).toString('base64url');
const der = (pem: string) =>
  pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');

function jws(payload: unknown, chain = CHAIN, key = KEY): string {
  const header = b64u(JSON.stringify({ alg: 'ES256', x5c: chain.map(der) }));
  const body = b64u(JSON.stringify(payload));
  const sig = cryptoSign('sha256', Buffer.from(`${header}.${body}`, 'ascii'), {
    key: createPrivateKey(key),
    dsaEncoding: 'ieee-p1363',
  });
  return `${header}.${body}.${b64u(sig)}`;
}

function notification(chain = CHAIN, key = KEY): string {
  return jws(
    {
      notificationType: 'DID_RENEW',
      notificationUUID: 'uuid-1',
      signedDate: Date.parse('2026-08-18T10:00:00Z'),
      data: {
        environment: 'Production',
        signedTransactionInfo: jws(
          {
            transactionId: '2000000000000009',
            originalTransactionId: '2000000000000001',
            productId: 'co.davidmasterson.crewchief.paid.monthly',
            expiresDate: Date.parse('2026-09-18T10:00:00Z'),
            environment: 'Production',
            signedDate: Date.parse('2026-08-18T10:00:00Z'),
          },
          chain,
          key
        ),
      },
    },
    chain,
    key
  );
}

const post = (body: unknown) =>
  POST({ json: async () => body } as unknown as Request) as Promise<Response>;

beforeEach(() => {
  applyVerifiedAppleEvent.mockReset();
  findUserByOriginalTransactionId.mockReset();
  findUserByOriginalTransactionId.mockResolvedValue({ ok: true, userId: 'user-1' });
  applyVerifiedAppleEvent.mockResolvedValue({ ok: true, applied: true, tier: 'paid' });
});

describe('codes that tell Apple to stop', () => {
  it('200 when the notification is applied', async () => {
    const response = await post({ signedPayload: notification() });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ received: true, applied: true });
    expect(applyVerifiedAppleEvent).toHaveBeenCalledWith('user-1', expect.anything());
  });

  it('200 for a transaction we have never seen, rather than retrying for three days', async () => {
    /*
      Not an error. It is a purchase whose verify call has not landed yet, or a
      sandbox purchase by somebody who never signed in — App Review, typically.
      Neither is fixed by redelivery.
    */
    findUserByOriginalTransactionId.mockResolvedValue({ ok: true, userId: null });

    const response = await post({ signedPayload: notification() });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ reason: 'unknown-transaction' });
    expect(applyVerifiedAppleEvent).not.toHaveBeenCalled();
  });

  it('401 for a payload Apple did not sign, because a retry cannot fix a signature', async () => {
    const response = await post({ signedPayload: notification(ROGUE_CHAIN, ROGUE_KEY) });

    expect(response.status).toBe(401);
    expect(applyVerifiedAppleEvent).not.toHaveBeenCalled();
  });

  it('400 for a body that is not a notification at all', async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ signedPayload: '' })).status).toBe(400);
    expect(applyVerifiedAppleEvent).not.toHaveBeenCalled();
  });
});

describe('codes that ask Apple to come back', () => {
  it('503 when the migration has not been applied, so the retry succeeds later', async () => {
    /*
      The notification is genuine and we cannot store it safely yet. 503 keeps
      it in Apple's retry queue, and it lands once the columns exist — which is
      the entire reason `entitlement-store` refuses rather than degrades.
    */
    applyVerifiedAppleEvent.mockResolvedValue({
      ok: false,
      reason: 'schema-not-ready',
      detail: 'column does not exist',
    });

    expect((await post({ signedPayload: notification() })).status).toBe(503);
  });

  it('500 when the lookup itself fails, which may be transient', async () => {
    findUserByOriginalTransactionId.mockResolvedValue({ ok: false, detail: 'timeout' });

    expect((await post({ signedPayload: notification() })).status).toBe(500);
    expect(applyVerifiedAppleEvent).not.toHaveBeenCalled();
  });

  it('500 on an unexpected write failure', async () => {
    applyVerifiedAppleEvent.mockResolvedValue({ ok: false, reason: 'write-failed', detail: 'x' });

    expect((await post({ signedPayload: notification() })).status).toBe(500);
  });
});

describe('an ignored notification is still a success', () => {
  it('200 when the decision layer declines a stale event', async () => {
    // A duplicate delivery must not be redelivered again for three days.
    applyVerifiedAppleEvent.mockResolvedValue({
      ok: true,
      applied: false,
      reason: 'stale-event',
    });

    const response = await post({ signedPayload: notification() });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ applied: false });
  });
});
