/**
 * Believing a payload came from Apple.
 *
 * @jest-environment node
 *
 * Phase 6, E8. Exercised against a **real certificate chain** rather than a
 * mocked verifier — `fixtures/apple-jws/` holds a throwaway three-level PKI
 * generated for this file, plus a second self-signed root that must never be
 * trusted. A test that stubs the crypto proves the code calls a function; this
 * proves the chain is actually checked.
 */

import { createPrivateKey, sign as cryptoSign, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readPinnedRoots, verifyAppleSignedPayload } from '@/lib/apple-jws';

const FIXTURES = join(__dirname, 'fixtures', 'apple-jws');
const read = (f: string) => readFileSync(join(FIXTURES, f), 'utf8');

const ROOT = read('root.crt');
const INTER = read('inter.crt');
const LEAF = read('leaf.crt');
const LEAF_KEY = read('leaf.key');
const ROGUE_ROOT = read('rogue.crt');
const ROGUE_LEAF = read('rogueleaf.crt');
const ROGUE_LEAF_KEY = read('rogueleaf.key');
/* An intermediate that expires 19 Aug 2026, under a leaf good until 2036. */
const SHORT_INTER = read('shortinter.crt');
const SHORT_INTER_LEAF = read('shortinterleaf.crt');
const SHORT_INTER_LEAF_KEY = read('shortinterleaf.key');

/** PEM → the base64 DER body, which is what `x5c` carries. */
function der(pem: string): string {
  return pem
    .replace(/-----(BEGIN|END) CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
}

const b64u = (b: Buffer | string) =>
  Buffer.from(b as never).toString('base64url');

/** Build a JWS the way Apple does: ES256, chain in `x5c`, raw r‖s signature. */
function makeJws(
  payload: unknown,
  {
    chain = [LEAF, INTER, ROOT],
    key = LEAF_KEY,
    alg = 'ES256',
    omitX5c = false,
    tamper = false,
  }: {
    chain?: string[];
    key?: string;
    alg?: string;
    omitX5c?: boolean;
    tamper?: boolean;
  } = {}
): string {
  const header: Record<string, unknown> = { alg };
  if (!omitX5c) header.x5c = chain.map(der);

  const encodedHeader = b64u(JSON.stringify(header));
  const encodedPayload = b64u(JSON.stringify(payload));

  const signature = cryptoSign(
    'sha256',
    Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii'),
    { key: createPrivateKey(key), dsaEncoding: 'ieee-p1363' }
  );

  const finalPayload = tamper ? b64u(JSON.stringify({ ...(payload as object), tampered: true })) : encodedPayload;
  return `${encodedHeader}.${finalPayload}.${b64u(signature)}`;
}

const ROOTS = [ROOT];
/*
  Comfortably inside the fixtures' ten-year window. It must be *after* the
  moment they were generated: the first version of this constant was earlier the
  same day and every test failed with `certificate-outside-validity-window`,
  which was the validity check working exactly as intended.
*/
const NOW = new Date('2027-01-01T00:00:00Z');

/**
 * When the deliberately short-lived intermediate stops being valid.
 *
 * ⚠ Read off the fixture rather than written down. LibreSSL cannot backdate a
 * certificate it signs, so regenerating the PKI moves this — and a hardcoded
 * date would silently turn the "while it is alive" half of the expiry test into
 * a second assertion that it is dead, which is the vacuous shape §5 is about.
 */
const SHORT_INTER_VALID_UNTIL = new Date(new X509Certificate(SHORT_INTER).validTo);

describe('the fixtures are a real chain, not decoration', () => {
  it('verifies a genuine payload end to end', () => {
    /*
      Anti-vacuous, and the assertion every negative test below leans on: if
      this fails, "rejected" proves nothing because everything is rejected.
    */
    const result = verifyAppleSignedPayload<{ notificationType: string }>(
      makeJws({ notificationType: 'DID_RENEW' }),
      { rootCertificates: ROOTS, now: NOW }
    );

    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.payload.notificationType).toBe('DID_RENEW');
  });
});

describe('an empty trust anchor is a hard failure, never a permissive default', () => {
  it('refuses to verify anything when no roots are configured', () => {
    /*
      The failure this whole file exists to prevent. An unset env var must not
      turn the verifier into a rubber stamp — the natural "no mismatch found"
      loop would accept a chain an attacker minted a minute ago, and nothing
      would log a word about it.
    */
    const result = verifyAppleSignedPayload(makeJws({ a: 1 }), {
      rootCertificates: [],
      now: NOW,
    });

    expect(result).toMatchObject({ ok: false, reason: 'no-pinned-roots-configured' });
  });

  it('reads no roots out of an unset variable, and says so rather than inventing one', () => {
    expect(readPinnedRoots(undefined)).toEqual([]);
    expect(readPinnedRoots('')).toEqual([]);
    expect(readPinnedRoots('not a certificate')).toEqual([]);
  });

  it('reads several concatenated roots, which is how a rotation survives', () => {
    const both = readPinnedRoots(`${ROOT}\n${ROGUE_ROOT}`);
    expect(both).toHaveLength(2);
    expect(both[0]).toContain('BEGIN CERTIFICATE');
  });
});

describe('a valid signature from the wrong authority is still a forgery', () => {
  it('rejects a correctly signed JWS whose chain does not reach a pinned root', () => {
    /*
      **The security test.** The rogue chain is internally perfect: the leaf is
      properly signed by its root, the signature over the payload is genuine,
      and every structural check passes. It is rejected purely because the
      anchor is not one we pinned — which is the only thing separating Apple
      from anybody with openssl.
    */
    const jws = makeJws({ notificationType: 'DID_RENEW' }, {
      chain: [ROGUE_LEAF, ROGUE_ROOT],
      key: ROGUE_LEAF_KEY,
    });

    // Sanity: it verifies fine against its own root, so the rejection below
    // is about the anchor and not about a malformed fixture.
    expect(verifyAppleSignedPayload(jws, { rootCertificates: [ROGUE_ROOT], now: NOW })).toMatchObject({
      ok: true,
    });

    expect(verifyAppleSignedPayload(jws, { rootCertificates: ROOTS, now: NOW })).toMatchObject({
      ok: false,
      reason: 'chain-does-not-reach-a-pinned-root',
    });
  });

  it('accepts a chain that stops at the intermediate, when the root is pinned', () => {
    // Legitimate shape: the anchor need not be transmitted to be trusted.
    const result = verifyAppleSignedPayload(makeJws({ a: 1 }, { chain: [LEAF, INTER] }), {
      rootCertificates: ROOTS,
      now: NOW,
    });

    expect(result).toMatchObject({ ok: true });
  });

  it('rejects a chain whose links do not actually sign each other', () => {
    const result = verifyAppleSignedPayload(makeJws({ a: 1 }, { chain: [LEAF, ROGUE_ROOT] }), {
      rootCertificates: [ROGUE_ROOT],
      now: NOW,
    });

    expect(result).toMatchObject({ ok: false, reason: 'broken-certificate-chain' });
  });
});

describe('the header does not get to choose how it is checked', () => {
  it('rejects alg: none, the oldest JWT hole there is', () => {
    expect(
      verifyAppleSignedPayload(makeJws({ a: 1 }, { alg: 'none' }), {
        rootCertificates: ROOTS,
        now: NOW,
      })
    ).toMatchObject({ ok: false, reason: 'unsupported-algorithm' });
  });

  it('rejects an algorithm downgrade', () => {
    expect(
      verifyAppleSignedPayload(makeJws({ a: 1 }, { alg: 'RS256' }), {
        rootCertificates: ROOTS,
        now: NOW,
      })
    ).toMatchObject({ ok: false, reason: 'unsupported-algorithm' });
  });

  it('rejects a payload with no chain at all', () => {
    expect(
      verifyAppleSignedPayload(makeJws({ a: 1 }, { omitX5c: true }), {
        rootCertificates: ROOTS,
        now: NOW,
      })
    ).toMatchObject({ ok: false, reason: 'missing-certificate-chain' });
  });

  it('rejects an absurdly long chain rather than parsing it', () => {
    const long = Array.from({ length: 7 }, () => LEAF);
    expect(
      verifyAppleSignedPayload(makeJws({ a: 1 }, { chain: long }), {
        rootCertificates: ROOTS,
        now: NOW,
      })
    ).toMatchObject({ ok: false, reason: 'chain-too-long' });
  });
});

describe('tampering and malformation', () => {
  it('rejects a payload edited after signing', () => {
    expect(
      verifyAppleSignedPayload(makeJws({ notificationType: 'REFUND' }, { tamper: true }), {
        rootCertificates: ROOTS,
        now: NOW,
      })
    ).toMatchObject({ ok: false, reason: 'bad-signature' });
  });

  it('rejects something that is not a JWS at all', () => {
    for (const bad of ['', 'a.b', 'a.b.c.d', 'a..c']) {
      expect(verifyAppleSignedPayload(bad, { rootCertificates: ROOTS, now: NOW })).toMatchObject({
        ok: false,
        reason: 'malformed-jws',
      });
    }
  });

  it('rejects a non-string input without throwing', () => {
    expect(
      verifyAppleSignedPayload(undefined as unknown as string, {
        rootCertificates: ROOTS,
        now: NOW,
      })
    ).toMatchObject({ ok: false, reason: 'malformed-jws' });
  });
});

describe('certificate validity is checked on every link, against a supplied clock', () => {
  it('rejects a chain that has expired', () => {
    expect(
      verifyAppleSignedPayload(makeJws({ a: 1 }), {
        rootCertificates: ROOTS,
        now: new Date('2099-01-01T00:00:00Z'),
      })
    ).toMatchObject({ ok: false, reason: 'certificate-outside-validity-window' });
  });

  it('rejects an expired intermediate under a leaf that is still fine', () => {
    /*
      ⚠ Added because mutation testing found this uncovered: narrowing the
      validity loop to `chain.slice(0, 1)` — checking the leaf and trusting the
      rest — passed every other test in this file. Every fixture shared one
      generation time, so moving the clock moved the whole chain together and
      nothing could tell "all of them" from "the first one".

      This chain cannot: the intermediate lives one day and the leaf beneath it
      runs to 2036. An expired intermediate is exactly as fatal as an expired
      leaf and considerably easier to miss.

      ⚠ **The dates moved on 24 Aug** when the fixture PKI was regenerated to
      carry `basicConstraints CA:TRUE` — the old `root.crt` had `CA:FALSE`, so
      it was not a faithful stand-in for Apple Root CA - G3 and could not
      exercise the issuer check added for IAP-04. LibreSSL cannot backdate a
      certificate it signs, so the fixtures start when they were generated and
      the two moments below are relative to that rather than absolute.
    */
    const WHILE_ALIVE = new Date(SHORT_INTER_VALID_UNTIL.getTime() - 6 * 60 * 60 * 1000);
    const jws = makeJws({ a: 1 }, {
      chain: [SHORT_INTER_LEAF, SHORT_INTER, ROOT],
      key: SHORT_INTER_LEAF_KEY,
    });

    expect(verifyAppleSignedPayload(jws, { rootCertificates: ROOTS, now: NOW })).toMatchObject({
      ok: false,
      reason: 'certificate-outside-validity-window',
    });

    // Anti-vacuous: the same chain verifies while the intermediate is alive.
    expect(
      verifyAppleSignedPayload(jws, {
        rootCertificates: ROOTS,
        now: WHILE_ALIVE,
      })
    ).toMatchObject({ ok: true });
  });

  it('rejects a chain that is not valid yet', () => {
    expect(
      verifyAppleSignedPayload(makeJws({ a: 1 }), {
        rootCertificates: ROOTS,
        now: new Date('2000-01-01T00:00:00Z'),
      })
    ).toMatchObject({ ok: false, reason: 'certificate-outside-validity-window' });
  });
});

/**
 * ── IAP-04: a signature is not an authorisation to sign ─────────────────────
 *
 * `verifyAppleSignedPayload` verified each link with pure signature maths and
 * consulted **neither** `.ca` nor `.keyUsage`, which Node exposes. No `CA:TRUE`
 * on intermediates, no path length. Only the *top* of the caller-supplied chain
 * was anchored; everything below was trusted on signature alone.
 *
 * So an attacker holding the private key for any certificate that chains to
 * Apple Root CA - G3 — an Apple Developer certificate at $99/yr being the
 * obvious candidate — could mint a subordinate, sign a forged transaction, and
 * submit the chain to `/api/internal/apple-notifications`, a public URL whose
 * docblock states *"The signature is the authentication."*
 */
describe('an issuer must be permitted to issue', () => {
  it('rejects a chain where a leaf is presented as an intermediate', () => {
    /*
      ⚠ The exact attack. `leaf.crt` is `CA:FALSE` — the kind of certificate
      Apple hands to every paying developer — and here it is used to vouch for a
      certificate beneath it. The signature maths is irrelevant: it is not
      allowed to sign certificates at all.

      Built by hand rather than with `makeJws`'s defaults so the chain is
      structurally the shape the finding describes.
    */
    const jws = makeJws({ a: 1 }, { chain: [ROGUE_LEAF, LEAF, INTER, ROOT], key: ROGUE_LEAF_KEY });

    expect(verifyAppleSignedPayload(jws, { rootCertificates: ROOTS, now: NOW })).toMatchObject({
      ok: false,
      reason: 'issuer-is-not-a-certificate-authority',
    });
  });

  it('still accepts the genuine chain, whose issuers are all CAs', () => {
    /*
      Anti-vacuous, and it is the case the fixture regeneration was for: the old
      `root.crt` was `CA:FALSE`, so it was never a faithful stand-in for Apple
      Root CA - G3 and this check would have rejected the honest chain too.
    */
    const jws = makeJws({ a: 1 });

    expect(verifyAppleSignedPayload(jws, { rootCertificates: ROOTS, now: NOW })).toMatchObject({
      ok: true,
    });
  });

  it('every issuer in the fixture chain is marked as a CA', () => {
    // Stated directly, because the whole test above is worthless if it is not.
    for (const pem of [ROOT, INTER]) {
      expect([pem.slice(0, 40), new X509Certificate(pem).ca]).toEqual([pem.slice(0, 40), true]);
    }

    // …and the leaf is not, which is what makes the first case an attack.
    expect(new X509Certificate(LEAF).ca).toBe(false);
  });
});
