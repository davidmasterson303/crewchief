/**
 * Unwrapping Apple's three-layer envelope.
 *
 * @jest-environment node
 *
 * Phase 6, E8. Built on the same throwaway PKI as `apple-jws.test.ts`, so the
 * nested signatures are real ones — the point of this file is that the *inner*
 * blobs are verified, and that cannot be shown with a stubbed verifier.
 */

import { createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseAppleNotification, parseAppleTransaction } from '@/lib/apple-notification';

const FIXTURES = join(__dirname, 'fixtures', 'apple-jws');
const read = (f: string) => readFileSync(join(FIXTURES, f), 'utf8');

const ROOT = read('root.crt');
const CHAIN = [read('leaf.crt'), read('inter.crt'), ROOT];
const KEY = read('leaf.key');
const ROGUE_CHAIN = [read('rogueleaf.crt'), read('rogue.crt')];
const ROGUE_KEY = read('rogueleaf.key');

const ROOTS = [ROOT];
const NOW = new Date('2027-01-01T00:00:00Z');
const MONTHLY = 'co.davidmasterson.crewchief.paid.monthly';
const SIGNED = Date.parse('2026-08-18T10:00:00Z');
const EXPIRES = Date.parse('2026-09-18T10:00:00Z');

/**
 * The bundle this deployment accepts — read from `apps/mobile/app.json` rather
 * than written down.
 *
 * ⚠ A hardcoded copy here would let the binary be renamed while these tests
 * kept passing against the old name, which is precisely the shape of thing that
 * makes a check pass for the wrong app.
 */
const BUNDLE_ID: string = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'apps', 'mobile', 'app.json'), 'utf8')
).expo.ios.bundleIdentifier;

const b64u = (b: Buffer | string) => Buffer.from(b as never).toString('base64url');
const der = (pem: string) =>
  pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');

function jws(payload: unknown, chain: string[] = CHAIN, key: string = KEY): string {
  const header = b64u(JSON.stringify({ alg: 'ES256', x5c: chain.map(der) }));
  const body = b64u(JSON.stringify(payload));
  const sig = cryptoSign('sha256', Buffer.from(`${header}.${body}`, 'ascii'), {
    key: createPrivateKey(key),
    dsaEncoding: 'ieee-p1363',
  });
  return `${header}.${body}.${b64u(sig)}`;
}

function transaction(over: Record<string, unknown> = {}) {
  return {
    /*
      ⚠ **IAP-03.** Apple has carried this since StoreKit 2 shipped, and this
      codebase never declared it, never parsed it and never compared it — so a
      transaction Apple signed for *any other app in the store* verified here and
      granted a paid tier. The only product gate was a name lookup in
      `PRODUCT_TIERS`, which is an accident of naming rather than a control.
    */
    bundleId: BUNDLE_ID,
    transactionId: '2000000000000009',
    originalTransactionId: '2000000000000001',
    productId: MONTHLY,
    expiresDate: EXPIRES,
    environment: 'Production',
    signedDate: SIGNED,
    ...over,
  };
}

function notification({
  txn = transaction(),
  renewal = { autoRenewStatus: 1 } as Record<string, unknown> | null,
  type = 'DID_RENEW',
  txnChain = CHAIN,
  txnKey = KEY,
  renewalChain = CHAIN,
  renewalKey = KEY,
}: {
  txn?: Record<string, unknown>;
  renewal?: Record<string, unknown> | null;
  type?: string;
  txnChain?: string[];
  txnKey?: string;
  renewalChain?: string[];
  renewalKey?: string;
} = {}): string {
  const data: Record<string, unknown> = {
    environment: 'Production',
    signedTransactionInfo: jws(txn, txnChain, txnKey),
  };
  if (renewal) data.signedRenewalInfo = jws(renewal, renewalChain, renewalKey);

  return jws({
    notificationType: type,
    notificationUUID: 'uuid-1',
    signedDate: SIGNED,
    data,
  });
}

describe('a notification becomes one event', () => {
  it('flattens all three layers into the fields the decision needs', () => {
    const result = parseAppleNotification(notification(), { rootCertificates: ROOTS, now: NOW, bundleId: BUNDLE_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event).toMatchObject({
      notificationType: 'DID_RENEW',
      originalTransactionId: '2000000000000001',
      productId: MONTHLY,
      expiresDate: EXPIRES,
      signedDate: SIGNED,
      environment: 'Production',
      autoRenewStatus: true,
    });
    expect(result.notificationUUID).toBe('uuid-1');
  });

  it('works without renewal info, which is often absent', () => {
    const result = parseAppleNotification(notification({ renewal: null }), { rootCertificates: ROOTS, now: NOW, bundleId: BUNDLE_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.autoRenewStatus).toBeNull();
    expect(result.event.gracePeriodExpiresDate).toBeNull();
  });

  it('reads autoRenewStatus as Apple sends it — 0 and 1, not a boolean', () => {
    /*
      Reading the number as truthy would turn any unexpected value into
      `false`, which renders as "the customer cancelled" on a screen.
    */
    const off = parseAppleNotification(notification({ renewal: { autoRenewStatus: 0 } }), { rootCertificates: ROOTS, now: NOW, bundleId: BUNDLE_ID });
    expect(off.ok && off.event.autoRenewStatus).toBe(false);

    const unknown = parseAppleNotification(
      notification({ renewal: { autoRenewStatus: 'yes' } }),
      { rootCertificates: ROOTS, now: NOW, bundleId: BUNDLE_ID }
    );
    expect(unknown.ok && unknown.event.autoRenewStatus).toBeNull();
  });

  it('prefers the transaction’s signing time over the envelope’s', () => {
    /*
      Both are Apple's, but the transaction is the thing whose state is being
      recorded. Ordering by when a change was *announced* rather than when it
      happened is how two notifications about one subscription get applied
      backwards.
    */
    const later = SIGNED + 60_000;
    const result = parseAppleNotification(
      jws({
        notificationType: 'DID_RENEW',
        signedDate: later,
        data: {
          environment: 'Production',
          signedTransactionInfo: jws(transaction({ signedDate: SIGNED })),
        },
      }),
      { rootCertificates: ROOTS, now: NOW, bundleId: BUNDLE_ID }
    );

    expect(result.ok && result.event.signedDate).toBe(SIGNED);
  });
});

describe('every layer is verified, not just the envelope', () => {
  it('rejects a forged transaction inside a genuine envelope', () => {
    /*
      **The test this module exists for.** The envelope is signed by the trusted
      chain; the transaction inside it is signed by the rogue one. The expiry
      and product id — the two fields that decide what an account gets and for
      how long — live in that inner blob, so verifying only the outside is
      checking the postmark and not the cheque.
    */
    const result = parseAppleNotification(
      notification({ txnChain: ROGUE_CHAIN, txnKey: ROGUE_KEY }),
      { rootCertificates: ROOTS, now: NOW, bundleId: BUNDLE_ID }
    );

    expect(result).toMatchObject({
      ok: false,
      reason: 'transaction:chain-does-not-reach-a-pinned-root',
    });
  });

  it('rejects a forged renewal blob rather than skipping it as optional', () => {
    // Absent means Apple sent none. Unverifiable means something is wrong.
    const result = parseAppleNotification(
      notification({ renewalChain: ROGUE_CHAIN, renewalKey: ROGUE_KEY }),
      { rootCertificates: ROOTS, now: NOW, bundleId: BUNDLE_ID }
    );

    expect(result).toMatchObject({
      ok: false,
      reason: 'renewal:chain-does-not-reach-a-pinned-root',
    });
  });

  it('rejects a forged envelope before it looks inside', () => {
    const forged = jws(
      {
        notificationType: 'DID_RENEW',
        signedDate: SIGNED,
        data: { environment: 'Production', signedTransactionInfo: jws(transaction()) },
      },
      ROGUE_CHAIN,
      ROGUE_KEY
    );

    expect(parseAppleNotification(forged, { rootCertificates: ROOTS, now: NOW, bundleId: BUNDLE_ID })).toMatchObject({
      ok: false,
      reason: 'envelope:chain-does-not-reach-a-pinned-root',
    });
  });

  it('rejects a notification carrying no transaction at all', () => {
    const empty = jws({ notificationType: 'DID_RENEW', signedDate: SIGNED, data: {} });
    expect(parseAppleNotification(empty, { rootCertificates: ROOTS, now: NOW, bundleId: BUNDLE_ID })).toMatchObject({
      ok: false,
      reason: 'missing-transaction-info',
    });
  });
});

describe('the fields without which there is nothing to record', () => {
  it.each([
    ['originalTransactionId', { originalTransactionId: undefined }],
    ['productId', { productId: undefined }],
    ['environment', { environment: undefined }],
    ['signedDate', { signedDate: undefined }],
  ])('refuses a transaction missing %s', (_name, missing) => {
    /*
      Guessing a default for `environment` would mean guessing whether a
      sandbox purchase counts as a real one.
    */
    const result = parseAppleNotification(
      jws({
        notificationType: 'DID_RENEW',
        data: { signedTransactionInfo: jws(transaction(missing)) },
      }),
      { rootCertificates: ROOTS, now: NOW, bundleId: BUNDLE_ID }
    );

    expect(result).toMatchObject({ ok: false, reason: 'missing-required-fields' });
  });

  it('falls back to the envelope environment when the transaction omits it', () => {
    // Anti-vacuous: the refusal above must be about absence, not strictness.
    const result = parseAppleNotification(
      jws({
        notificationType: 'DID_RENEW',
        signedDate: SIGNED,
        data: {
          environment: 'Sandbox',
          signedTransactionInfo: jws(transaction({ environment: undefined })),
        },
      }),
      { rootCertificates: ROOTS, now: NOW, bundleId: BUNDLE_ID }
    );

    expect(result.ok && result.event.environment).toBe('Sandbox');
  });
});

describe('a bare StoreKit transaction, as the purchase path sends it', () => {
  it('reads as a subscription', () => {
    const result = parseAppleTransaction(jws(transaction()), { rootCertificates: ROOTS, now: NOW, bundleId: BUNDLE_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.notificationType).toBe('SUBSCRIBED');
    expect(result.event.productId).toBe(MONTHLY);
  });

  it('reads a revoked transaction as a revocation, not a purchase', () => {
    const revokedAt = Date.parse('2026-08-18T11:00:00Z');
    const result = parseAppleTransaction(
      jws(transaction({ revocationDate: revokedAt })),
      { rootCertificates: ROOTS, now: NOW, bundleId: BUNDLE_ID }
    );

    expect(result.ok && result.event.notificationType).toBe('REVOKE');
    expect(result.ok && result.event.revocationDate).toBe(revokedAt);
  });

  it('rejects a transaction signed by anyone but Apple', () => {
    expect(
      parseAppleTransaction(jws(transaction(), ROGUE_CHAIN, ROGUE_KEY), { rootCertificates: ROOTS, now: NOW, bundleId: BUNDLE_ID })
    ).toMatchObject({ ok: false, reason: 'transaction:chain-does-not-reach-a-pinned-root' });
  });
});

/**
 * ── IAP-03: Apple signed it, but not for us ─────────────────────────────────
 *
 * `bundleId` was not declared on `TransactionInfo`, so it was never parsed and
 * never compared — a repo-wide search returned exactly one hit, `app.json:11`,
 * the Expo config. Apple's WWDR chain signs transactions for **every app in the
 * store**, so a verified chain proved *"Apple signed this"*, not *"Apple signed
 * this for Well Kept"*. The only product gate was a name lookup in
 * `PRODUCT_TIERS` — an accident of naming, not a control.
 */
describe('a transaction has to be for this app', () => {
  const options = { rootCertificates: ROOTS, now: NOW, bundleId: BUNDLE_ID };

  it('refuses a correctly signed transaction from another app', () => {
    const foreign = jws(transaction({ bundleId: 'com.someone.else' }));

    expect(parseAppleTransaction(foreign, options)).toMatchObject({
      ok: false,
      reason: 'transaction-is-for-another-app',
    });
  });

  it('refuses one with no bundleId at all', () => {
    /*
      ⚠ Refused, not waved through. Apple has carried this field since StoreKit
      2 shipped, so a transaction without one is malformed or not Apple's — and
      "the field we check is missing, so skip the check" makes a control optional
      for exactly the payloads that would fail it.
    */
    const { bundleId: _dropped, ...withoutBundle } = transaction();

    expect(parseAppleTransaction(jws(withoutBundle), options)).toMatchObject({
      ok: false,
      reason: 'transaction-is-for-another-app',
    });
  });

  it('refuses a notification whose inner transaction is another app’s', () => {
    // Both entry points, because the notification path is the public URL.
    const foreign = notification({ txn: transaction({ bundleId: 'com.someone.else' }) });

    expect(parseAppleNotification(foreign, options)).toMatchObject({
      ok: false,
      reason: 'transaction-is-for-another-app',
    });
  });

  it('still accepts our own', () => {
    // Anti-vacuous: a check that refused everything would pass all three above.
    expect(parseAppleTransaction(jws(transaction()), options)).toMatchObject({ ok: true });
    expect(parseAppleNotification(notification({}), options)).toMatchObject({ ok: true });
  });

  it('reads the bundle id from the binary, so the two cannot drift', () => {
    expect(BUNDLE_ID).toBe('co.davidmasterson.crewchief');
  });
});
