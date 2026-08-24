/**
 * Verifying that a payload really came from Apple.
 *
 * Phase 6, E8. App Store Server Notifications and StoreKit 2 transactions both
 * arrive as a JWS — `header.payload.signature`, ES256, with the signing
 * certificate chain carried in the header's `x5c`. This decides whether to
 * believe one.
 *
 * ── Why this is written out rather than taken from a library ────────────────
 *
 * `jws` and `node-forge` are both present in `node_modules` today, and neither
 * is in any `package.json` in this repo — they are transitive, and a transitive
 * dependency disappears the day its parent bumps. `CLAUDE.md` §3 records what
 * that already cost once here: `main` importing packages absent from
 * `package.json`, unbuildable on a fresh clone, for four commits.
 *
 * Node 24's `crypto.X509Certificate` does the whole job — chain checking,
 * validity windows and ECDSA verification — so the honest options were a
 * declared new dependency or no dependency, and this is short enough that no
 * dependency wins.
 *
 * ── ⚠ The two failures that would look exactly like success ─────────────────
 *
 * **1. Trusting the `alg` header.** The oldest JWT vulnerability in existence:
 * a payload that names its own algorithm, including `none`, and a verifier
 * polite enough to use it. `ES256` is required here as a literal. Apple signs
 * with nothing else, so there is no flexibility to lose.
 *
 * **2. An empty trust anchor.** If `rootCertificates` arrives empty — an unset
 * environment variable, a bad deploy, a typo in a key name — the natural
 * implementations of "the chain must reach a pinned root" is a loop that finds
 * no mismatch and returns true. Verification would pass for **any** chain,
 * including one an attacker generated a minute ago, and nothing anywhere would
 * report a problem. This is the same shape as `CLAUDE.md` §7's *a monitor that
 * is not running reads as good news*, and it is why the very first check in
 * this file is that there is something to verify against at all.
 *
 * ── Failure is a value, not an exception ────────────────────────────────────
 *
 * Every rejection returns a reason. The webhook needs that: Apple retries any
 * non-2xx, so a route that throws on a malformed payload earns itself a retry
 * loop that never converges, and the log line that explains it must survive.
 */

import { X509Certificate, verify as cryptoVerify } from 'node:crypto';

export type JwsFailureReason =
  /** Nothing to verify against — see the docblock. Always a deployment fault. */
  | 'no-pinned-roots-configured'
  | 'malformed-jws'
  | 'unsupported-algorithm'
  | 'missing-certificate-chain'
  | 'malformed-certificate'
  | 'chain-too-long'
  | 'broken-certificate-chain'
  /*
    ⚠ IAP-04. An intermediate without `CA:TRUE`, or a CA whose `keyUsage`
    excludes `keyCertSign`. Both are the same class of finding: signature maths
    proving a certificate was signed says nothing about whether its issuer was
    permitted to sign it.
  */
  | 'issuer-is-not-a-certificate-authority'
  | 'chain-does-not-reach-a-pinned-root'
  | 'certificate-outside-validity-window'
  | 'bad-signature'
  | 'malformed-payload';

export type JwsVerification<T> =
  | { ok: true; payload: T }
  | { ok: false; reason: JwsFailureReason; detail?: string };

/**
 * Apple sends leaf + intermediate + root. More than a handful is not a longer
 * chain, it is someone probing how much certificate parsing they can make this
 * process do per request.
 */
const MAX_CHAIN_LENGTH = 6;

export interface VerifyOptions {
  /**
   * PEM-encoded roots to anchor the chain against — Apple Root CA - G3 in
   * production. **Must be non-empty**; an empty list is a hard failure rather
   * than a permissive default.
   */
  rootCertificates: readonly string[];
  /** Supplied rather than read, so certificate expiry is testable. */
  now?: Date;
}

/**
 * Verify an Apple JWS and return its decoded payload.
 *
 * The payload is returned as `unknown`-shaped `T` and is **not** validated
 * beyond being JSON: what a notification body must contain is a different
 * question, answered by the caller, and conflating the two would mean a schema
 * change could be mistaken for a signature failure.
 */
export function verifyAppleSignedPayload<T = unknown>(
  signedPayload: string,
  { rootCertificates, now = new Date() }: VerifyOptions
): JwsVerification<T> {
  /*
    First, before anything is parsed. See the docblock — this is the check
    whose absence makes every other check in this file decorative.
  */
  if (!rootCertificates || rootCertificates.length === 0) {
    return {
      ok: false,
      reason: 'no-pinned-roots-configured',
      detail: 'refusing to verify against an empty trust anchor',
    };
  }

  if (typeof signedPayload !== 'string') {
    return { ok: false, reason: 'malformed-jws', detail: 'not a string' };
  }

  const parts = signedPayload.split('.');
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
    return { ok: false, reason: 'malformed-jws', detail: `${parts.length} segments` };
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  let header: { alg?: unknown; x5c?: unknown };
  try {
    header = JSON.parse(base64UrlToBuffer(encodedHeader).toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed-jws', detail: 'header is not JSON' };
  }

  /*
    A literal, not a lookup. `alg: "none"` and an RSA downgrade both die here.
  */
  if (header.alg !== 'ES256') {
    return { ok: false, reason: 'unsupported-algorithm', detail: String(header.alg) };
  }

  if (!Array.isArray(header.x5c) || header.x5c.length === 0) {
    return { ok: false, reason: 'missing-certificate-chain' };
  }
  if (header.x5c.length > MAX_CHAIN_LENGTH) {
    return { ok: false, reason: 'chain-too-long', detail: String(header.x5c.length) };
  }

  let chain: X509Certificate[];
  try {
    chain = header.x5c.map((entry) => {
      if (typeof entry !== 'string') throw new Error('x5c entry is not a string');
      // x5c is standard base64 DER, not base64url — RFC 7515 §4.1.6.
      return new X509Certificate(Buffer.from(entry, 'base64'));
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'malformed-certificate',
      detail: error instanceof Error ? error.message : 'unparseable',
    };
  }

  /*
    Validity is checked on every certificate in the chain, not just the leaf.
    An expired intermediate is exactly as fatal and considerably easier to miss.
  */
  for (const certificate of chain) {
    if (!isWithinValidity(certificate, now)) {
      return {
        ok: false,
        reason: 'certificate-outside-validity-window',
        detail: `${certificate.subject} valid ${certificate.validFrom} … ${certificate.validTo}`,
      };
    }
  }

  /*
    Each certificate must actually be signed by the next one up. `checkIssued`
    compares names; `verify` checks the signature. Both, because the first
    without the second is an assertion about strings.

    ── ⚠ IAP-04 · signature maths is not the whole of chain validation ─────────

    This loop used to be exactly that and nothing else, and the gap is a
    documented deviation from Apple's own procedure. Node's `X509Certificate`
    exposes `.ca` and `.keyUsage`; **neither was consulted anywhere in this
    file.** No `CA:TRUE` check on intermediates, no `keyCertSign`, no path
    length. Only the *top* of the caller-supplied chain was anchored; everything
    below it was trusted on signature alone.

    The consequence: an attacker holding the private key for **any** certificate
    that chains to Apple Root CA - G3 — an Apple Developer certificate at $99/yr
    being the obvious candidate — could mint a subordinate, sign a forged
    transaction, and submit the chain. `/api/internal/apple-notifications` is a
    public URL whose docblock states *"The signature is the authentication."*

    ⚠ One thing remains genuinely uncertain and is worth writing down rather
    than implying away: whether today's Apple WWDR developer intermediate is
    itself issued by Root CA - **G3** or by the older RSA root. If G1, the forged
    chain breaks at the anchor and this was defence in depth all along. The two
    checks below are correct either way — they are what Apple's own
    `app-store-server-library` does — so the answer changes the severity, not
    the fix. Confirm at apple.com/certificateauthority/.
  */
  for (let i = 0; i < chain.length - 1; i += 1) {
    const child = chain[i];
    const parent = chain[i + 1];

    /*
      ⚠ **The parent must be allowed to be a CA.** Without this, a leaf
      certificate — which Apple issues to any paying developer — can be
      presented as an intermediate and used to vouch for a forged certificate
      beneath it. `basicConstraints CA:TRUE` is the field that distinguishes
      "may sign other certificates" from "may sign data", and it is the whole
      point of the extension.
    */
    if (parent.ca !== true) {
      return {
        ok: false,
        reason: 'issuer-is-not-a-certificate-authority',
        detail: `${parent.subject} has no CA:TRUE basic constraint`,
      };
    }

    /*
      ⚠ **There is deliberately no `keyCertSign` check here**, and the gap is
      worth stating rather than leaving unexplained.

      Apple's own `app-store-server-library` checks the basic `keyUsage`
      extension for `keyCertSign` on every issuer. Node's
      `X509Certificate.keyUsage` **is not that field** — it exposes the
      *extended* key usage OIDs, and returns `undefined` for a certificate
      carrying `keyUsage = critical,keyCertSign,cRLSign`. Verified against a
      generated fixture with exactly those bits set.

      So the check cannot be written from what Node exposes without parsing the
      DER by hand, and a check that silently never fires is worse than none —
      it is `.tap-target-44` matching a comment six hundred lines above the
      rule. `CA:TRUE` above is the load-bearing half and is genuinely
      available; this is the residual, stated.
    */
    if (!child.checkIssued(parent) || !safeVerify(child, parent)) {
      return {
        ok: false,
        reason: 'broken-certificate-chain',
        detail: `${child.subject} is not signed by ${parent.subject}`,
      };
    }
  }

  let roots: X509Certificate[];
  try {
    roots = rootCertificates.map((pem) => new X509Certificate(pem));
  } catch (error) {
    return {
      ok: false,
      reason: 'malformed-certificate',
      detail: `pinned root: ${error instanceof Error ? error.message : 'unparseable'}`,
    };
  }

  /*
    The anchor check, and the reason it is by raw DER rather than by subject.

    Comparing issuer strings would accept a self-signed certificate whose
    subject says "Apple Root CA - G3", which anyone can produce in a second.
    Byte equality of the encoded certificate cannot be forged without the
    private key it was signed with.

    Two shapes are accepted because both are legitimate: Apple includes its root
    in `x5c`, so the top of the chain *is* the anchor; and a chain that stops at
    the intermediate is still trustworthy if that intermediate was signed by a
    pinned root.
  */
  const top = chain[chain.length - 1];
  const anchored =
    roots.some((root) => root.raw.equals(top.raw)) ||
    roots.some((root) => top.checkIssued(root) && safeVerify(top, root));

  if (!anchored) {
    return {
      ok: false,
      reason: 'chain-does-not-reach-a-pinned-root',
      detail: top.subject,
    };
  }

  /*
    Only now the signature, and only with the leaf's key.

    ⚠ `dsaEncoding: 'ieee-p1363'`. JWS carries an ECDSA signature as the raw
    r‖s pair; Node's default for ECDSA is DER. Getting this wrong does not
    throw — `verify` simply returns false for every well-formed signature,
    which reads as "Apple's payloads are all invalid" and sends you looking at
    the wrong half of the system.
  */
  const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii');
  let signatureValid: boolean;
  let signatureError: string | undefined;
  try {
    signatureValid = cryptoVerify(
      'sha256',
      signingInput,
      // `X509Certificate.publicKey` is already a KeyObject. Wrapping it in
      // `createPublicKey()` throws ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE — which
      // the first draft of this file did, and the blanket catch below reported
      // as `bad-signature`. Every genuine payload looked forged. The detail is
      // carried now precisely so that mistake cannot present as Apple lying.
      { key: chain[0].publicKey, dsaEncoding: 'ieee-p1363' },
      base64UrlToBuffer(encodedSignature)
    );
  } catch (error) {
    signatureValid = false;
    signatureError = error instanceof Error ? `${error.name}: ${error.message}` : 'threw';
  }

  if (!signatureValid) {
    return { ok: false, reason: 'bad-signature', detail: signatureError };
  }

  try {
    return { ok: true, payload: JSON.parse(base64UrlToBuffer(encodedPayload).toString('utf8')) as T };
  } catch {
    return { ok: false, reason: 'malformed-payload', detail: 'payload is not JSON' };
  }
}

/**
 * Read pinned roots out of an environment variable.
 *
 * Multiple PEM blocks may be concatenated, which is how a root rotation is
 * survived: both the outgoing and incoming anchors are trusted for the overlap
 * rather than there being a moment where neither is.
 *
 * Returns an empty array when unset, which `verifyAppleSignedPayload` treats as
 * a hard failure — deliberately, so a missing variable is loud rather than
 * permissive.
 */
export function readPinnedRoots(value: string | undefined | null): string[] {
  if (!value) return [];
  const blocks = value.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  return blocks ?? [];
}

function isWithinValidity(certificate: X509Certificate, now: Date): boolean {
  const from = Date.parse(certificate.validFrom);
  const to = Date.parse(certificate.validTo);
  if (Number.isNaN(from) || Number.isNaN(to)) return false;
  const at = now.getTime();
  return at >= from && at <= to;
}

/** `verify` throws on some malformed key/cert pairings rather than returning false. */
function safeVerify(child: X509Certificate, parent: X509Certificate): boolean {
  try {
    return child.verify(parent.publicKey);
  } catch {
    return false;
  }
}

function base64UrlToBuffer(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}
