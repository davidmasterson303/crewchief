/**
 * The pinned trust anchor.
 *
 * @jest-environment node
 *
 * Phase 6, E8. Everything Apple sends is believed on the strength of this one
 * certificate, so the assertions here are about *identity* rather than
 * behaviour: is the thing in the repo still the thing we fetched from Apple,
 * and can anything at runtime quietly replace it.
 */

import {
  X509Certificate,
  createHash,
  createPrivateKey,
  sign as cryptoSign,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { verifyAppleSignedPayload } from '@/lib/apple-jws';
import {
  APPLE_ROOT_CA_G3,
  APPLE_ROOT_CA_G3_SHA256,
  getAppleRootCertificates,
} from '@/lib/apple-root-ca';

const ROGUE = readFileSync(
  join(__dirname, 'fixtures', 'apple-jws', 'rogue.crt'),
  'utf8'
);

const certificate = new X509Certificate(APPLE_ROOT_CA_G3);

/** Colon-separated uppercase hex, matching `openssl x509 -fingerprint`. */
function sha256Of(cert: X509Certificate): string {
  const digest = createHash('sha256').update(cert.raw).digest('hex').toUpperCase();
  return (digest.match(/.{2}/g) ?? []).join(':');
}

describe('the committed certificate is still Apple Root CA - G3', () => {
  it('matches the pinned fingerprint', () => {
    /*
      The assertion that makes the committed PEM tamper-evident. A swapped
      certificate is otherwise a diff of unreadable base64 — this turns it into
      a named test failure.
    */
    expect(sha256Of(certificate)).toBe(APPLE_ROOT_CA_G3_SHA256);
  });

  it('is Apple’s, and is a self-signed root', () => {
    expect(certificate.subject).toContain('Apple Root CA - G3');
    expect(certificate.subject).toContain('Apple Inc.');
    // A root is its own issuer, and proves it by verifying under its own key.
    expect(certificate.issuer).toBe(certificate.subject);
    expect(certificate.verify(certificate.publicKey)).toBe(true);
    expect(certificate.ca).toBe(true);
  });

  it('has not expired', () => {
    /*
      ⚠ This is time-dependent on purpose. G3 expires 30 April 2039, and when
      that day comes this test failing is the alarm rather than the bug: every
      Apple payload would start being rejected, and a red test naming the
      expiry is a considerably better way to find that out than a support
      ticket about purchases silently failing.
    */
    const now = Date.now();
    expect(Date.parse(certificate.validFrom)).toBeLessThan(now);
    expect(Date.parse(certificate.validTo)).toBeGreaterThan(now);
  });
});

describe('nothing at runtime can replace the anchor', () => {
  it('is present with no environment variable set', () => {
    const roots = getAppleRootCertificates(undefined);
    expect(roots).toHaveLength(1);
    expect(roots[0]).toContain('BEGIN CERTIFICATE');
    expect(new X509Certificate(roots[0]).subject).toContain('Apple Root CA - G3');
  });

  it('appends an extra root without displacing the pinned one', () => {
    // The rotation case: trust a successor alongside G3, not instead of it.
    const roots = getAppleRootCertificates(ROGUE);
    expect(roots).toHaveLength(2);
    expect(sha256Of(new X509Certificate(roots[0]))).toBe(APPLE_ROOT_CA_G3_SHA256);
  });

  it('degrades to exactly the security we have now when the variable is junk', () => {
    /*
      A typo, a truncated paste, an empty value. Every one of these must leave
      the real anchor standing — the failure mode to avoid is a bad environment
      variable quietly turning verification off, which is the same hazard
      `apple-jws.ts` refuses an empty root list for.
    */
    for (const junk of ['', '   ', 'not a certificate', '-----BEGIN CERTIFICATE-----']) {
      const roots = getAppleRootCertificates(junk);
      expect(roots).toHaveLength(1);
      expect(sha256Of(new X509Certificate(roots[0]))).toBe(APPLE_ROOT_CA_G3_SHA256);
    }
  });
});

describe('the anchor is actually wired into the verifier', () => {
  it('is accepted by verifyAppleSignedPayload as a usable trust anchor', () => {
    /*
      End-to-end plumbing check. A real Apple JWS cannot be produced here — that
      needs a purchase — but the failure this guards against does not need one:
      if the committed PEM were malformed, unparseable or empty, every payload
      would be rejected with `malformed-certificate` rather than with a verdict
      about the payload itself.

      Feeding it a chain signed by the *test* PKI proves both halves at once:
      the anchor parses (so the rejection is a real decision), and it correctly
      refuses a chain that does not descend from Apple.
    */
    const testChainJws = buildTestChainJws();

    const result = verifyAppleSignedPayload(testChainJws, {
      rootCertificates: getAppleRootCertificates(undefined),
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'chain-does-not-reach-a-pinned-root',
    });
    // Not a parse failure — which is what a broken anchor would produce.
    expect(result).not.toMatchObject({ reason: 'malformed-certificate' });
  });
});

/** A structurally valid JWS from the throwaway PKI, for the check above. */
function buildTestChainJws(): string {
  const dir = join(__dirname, 'fixtures', 'apple-jws');
  const der = (pem: string) =>
    pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
  const b64u = (b: Buffer | string) => Buffer.from(b as never).toString('base64url');

  const header = b64u(
    JSON.stringify({
      alg: 'ES256',
      x5c: ['leaf.crt', 'inter.crt', 'root.crt'].map((f) =>
        der(readFileSync(join(dir, f), 'utf8'))
      ),
    })
  );
  const payload = b64u(JSON.stringify({ notificationType: 'DID_RENEW' }));
  const signature = cryptoSign(
    'sha256',
    Buffer.from(`${header}.${payload}`, 'ascii'),
    { key: createPrivateKey(readFileSync(join(dir, 'leaf.key'), 'utf8')), dsaEncoding: 'ieee-p1363' }
  );
  return `${header}.${payload}.${b64u(signature)}`;
}
