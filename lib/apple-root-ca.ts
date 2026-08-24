/**
 * The trust anchor everything Apple sends is checked against.
 *
 * Phase 6, E8. `verifyAppleSignedPayload` refuses to verify anything without a
 * pinned root — deliberately, so a misconfiguration is loud rather than
 * permissive. This is what it is normally given.
 *
 * ── ⚠ Why this is committed rather than an environment variable ─────────────
 *
 * The obvious shape was `APPLE_ROOT_CA_PEM` on Netlify. It is the wrong one
 * here, for two reasons that point the same way.
 *
 * **It is not a secret.** Apple publishes it at
 * `apple.com/certificateauthority/AppleRootCA-G3.cer`; every Apple device on
 * earth already has it. Nothing is protected by keeping it out of the repo, and
 * `CLAUDE.md` §7 records the cost of the alternative: a value needed in two
 * places, where setting one looks done. Committed, it is needed in none.
 *
 * **A trust anchor should not be changeable without review.** As an environment
 * variable, anyone with dashboard access could repoint what this application
 * trusts, silently, with no diff and no commit — and the failure would be
 * invisible, because a forged chain under a swapped root verifies perfectly.
 * As a file, changing it is a commit somebody has to approve, and
 * `apple-root-ca.test.ts` pins the fingerprint so the change is legible rather
 * than a wall of base64.
 *
 * It is embedded as a string rather than read from a `.pem` at runtime because
 * these routes run as Netlify functions, and a bundler that does not trace a
 * data file turns a pinned root into an absent one — which the verifier would
 * correctly refuse to work without, at the worst possible moment.
 *
 * ── The environment variable that remains, and what it cannot do ────────────
 *
 * `APPLE_ROOT_CA_PEM` still exists, and it can only **add**. Apple Root CA - G3
 * expires 30 April 2039; if that ever needs to overlap with a successor, the
 * new anchor can be trusted without a deploy. It cannot remove or replace this
 * one, so a typo, a truncated paste or an empty value degrades to *exactly the
 * security we have now* rather than to none.
 */

import { readPinnedRoots } from '@/lib/apple-jws';

/**
 * Apple Root CA - G3. Self-signed, EC P-384, valid 30 Apr 2014 → 30 Apr 2039.
 *
 * Fetched from apple.com over HTTPS on 18 Aug 2026 and checked before use:
 * subject equals issuer, `CA:TRUE` critical, and it verifies against itself.
 */
export const APPLE_ROOT_CA_G3 = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`;

/**
 * SHA-256 of the DER encoding above.
 *
 * Pinned as a literal so that swapping the certificate is a test failure rather
 * than a diff nobody can read. This is the assertion that makes the committed
 * PEM tamper-evident.
 */
export const APPLE_ROOT_CA_G3_SHA256 =
  '63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79';

/**
 * Every root the application will anchor an Apple chain to.
 *
 * The committed anchor is always present and always first. Anything in
 * `APPLE_ROOT_CA_PEM` is appended, never substituted — see the docblock.
 */
export function getAppleRootCertificates(
  env: string | undefined = process.env.APPLE_ROOT_CA_PEM
): string[] {
  return [APPLE_ROOT_CA_G3, ...readPinnedRoots(env)];
}

/**
 * The bundle identifier this deployment accepts transactions for — IAP-03.
 *
 * ── ⚠ Why it is a constant and not an environment variable ──────────────────
 *
 * It is a property of **the binary**, not of the deployment. `app.json` says
 * `co.davidmasterson.crewchief` and there is exactly one app; a variable would
 * introduce a way for the two to disagree, and the failure mode of them
 * disagreeing is that the check passes for the wrong app or fails for the right
 * one — neither of which is visible until somebody's subscription breaks.
 *
 * `apps/mobile/app.json` is the source of truth and
 * `lib/__tests__/apple-notification.test.ts` reads it to keep this in step, so
 * renaming the bundle in one place fails the build rather than the purchase.
 */
export const APPLE_BUNDLE_ID = 'co.davidmasterson.crewchief';
