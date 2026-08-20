/*
  # A subscription has more states than paid or not

  Phase 6, E8. **Additive only** — five nullable columns on one existing table.
  No column is dropped or retyped, no row changes, no policy or grant is
  touched. The "Potential issue detected" modal should NOT fire on this one.

  ⚠ Written, not applied. Applying is Cowork's/David's.

  ## Why the E7 shape was not enough

  `20260812120000` created this table to answer one question — *entitled until
  when* — and that was the right question for E7, which only reads. E8 writes,
  and writing means receiving App Store Server Notifications, which carry three
  states the existing five columns cannot represent:

  **A refund is not a lapse.** `expires_at` says a subscription runs until the
  14th. A refund on the 2nd means it does not, and the money has gone back.
  With only `expires_at` the choice is to leave a refunded customer with a
  working product, or to overwrite the expiry and lose the fact that it was
  revoked rather than simply run out. `revoked_at` records the difference.

  **Sandbox and Production share an identifier space.** Anyone with a developer
  account can make a free sandbox purchase against this bundle id. Without
  `environment` on the row there is no way to refuse a sandbox notification
  that would otherwise extend a real, paid subscription — and App Review runs
  entirely in sandbox, so refusing sandbox outright is not available either.

  **Apple does not guarantee notification order.** Retries make that routine:
  a `DID_RENEW` signed at 10:00 can arrive after the `EXPIRED` signed at 10:05.
  Applied in arrival order it resurrects a dead subscription, silently.
  `last_signed_date` stores Apple's own signing time of the last event applied,
  so an out-of-order delivery can be recognised and dropped. It is the one
  column here that exists purely to defend against a failure with no symptom.

  The remaining two are smaller. `auto_renew_status` is display only — "renews
  on the 14th" versus "ends on the 14th" — and must never decide entitlement,
  because turning off auto-renew means *do not charge me again*, not *cut me
  off now*. `latest_transaction_id` is the current period's transaction, kept
  for support and for reconciling against the App Store Server API;
  `original_transaction_id` remains the identity and stays UNIQUE.

  ## Why every column is nullable with no default

  These describe a subscription, and the overwhelming majority of rows will
  never have one. A `NOT NULL DEFAULT` would write a fact about Apple onto
  every free account, and `environment` in particular has no honest default:
  an account that has never purchased anything is in neither environment.

  NULL here means "we have never been told", which is exactly the state.

  ## Deploy ordering

  Additive columns are safe in both directions, and this is deliberate rather
  than lucky: code that predates them ignores them, and code that reads them
  before they exist gets `42703` — which the writer treats as "no subscription
  state recorded" rather than as an error, on the same reasoning
  `readFailureMeansNoSubscription` uses for the missing table. So this can be
  applied before or after the code ships without a window where either is
  broken.

  Grants and policies are untouched on purpose. Table-level `GRANT SELECT`
  covers columns added later, and the security property that matters — that
  `authenticated` holds no INSERT, UPDATE or DELETE — is a property of the
  table, not of its column list. `entitlement-not-user-writable.test.ts`
  replays this file with the rest and would fail if this granted anything.
*/

ALTER TABLE public.account_entitlements
  -- 'Sandbox' | 'Production', taken from inside Apple's signed payload rather
  -- than from anything a client asserts. NULL until a purchase happens.
  ADD COLUMN IF NOT EXISTS environment text,

  -- When a refund or family-sharing revocation ended access, regardless of
  -- what expires_at says. NULL is the normal case, not a missing value.
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,

  -- Whether Apple will charge again. Display only — never entitlement.
  ADD COLUMN IF NOT EXISTS auto_renew_status boolean,

  -- This period's transaction. original_transaction_id remains the identity.
  ADD COLUMN IF NOT EXISTS latest_transaction_id text,

  -- Apple's signedDate of the last notification applied. The ordering guard
  -- against out-of-order delivery. Not our clock, deliberately: our clock says
  -- when we received it, which is the thing that is wrong.
  ADD COLUMN IF NOT EXISTS last_signed_date timestamptz;

/*
  Environment is a closed set and a typo in it disables the sandbox guard
  silently — the comparison simply stops matching and every sandbox
  notification is accepted. A CHECK is cheap and turns that into a write error.

  NOT VALID would let existing rows through unchecked; there are none, and the
  column is new, so the constraint is validated immediately.
*/
ALTER TABLE public.account_entitlements
  DROP CONSTRAINT IF EXISTS account_entitlements_environment_check;

ALTER TABLE public.account_entitlements
  ADD CONSTRAINT account_entitlements_environment_check
  CHECK (environment IS NULL OR environment IN ('Sandbox', 'Production'));

COMMENT ON COLUMN public.account_entitlements.environment IS
  'Sandbox or Production, from inside Apple''s signed payload. A sandbox notification must never overwrite a Production entitlement.';

COMMENT ON COLUMN public.account_entitlements.revoked_at IS
  'When a refund or revocation ended access. A refund is not a lapse: expires_at may still be in the future.';

COMMENT ON COLUMN public.account_entitlements.last_signed_date IS
  'Apple''s signedDate of the last notification applied. Apple does not guarantee order; an event not strictly newer than this is dropped.';
