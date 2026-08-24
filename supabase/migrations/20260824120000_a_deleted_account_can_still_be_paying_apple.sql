/*
  Deleting an account permanently orphaned a live Apple subscription.

  ── ⚠ The defect, from the 24 Aug QA audit (IAP-05) ────────────────────────

  `account_entitlements.user_id` is `ON DELETE CASCADE`, and `deleteAccount()`
  **never reads that table** before calling `auth.admin.deleteUser`. So the row
  goes — `tier`, `expires_at`, and critically `original_transaction_id` — and
  nothing is written anywhere first. The tombstone log records vehicles and
  storage objects and nothing about a subscription.

  What follows:

    - **Apple keeps billing them, monthly, indefinitely.** Deleting an account
      here does not cancel anything at Apple's end; only the customer can, from
      Settings.
    - Every `DID_RENEW` arrives, finds no owner, and returns `200 received:true
      applied:false` **at info level** — indistinguishable from the benign case
      of a notification for somebody who never existed.
    - When they email support **there is no transaction id on file** to
      reconcile against. The one identifier that would let anybody help them was
      deleted with the row.
    - Second-order, and worse: the transaction becomes unowned, so the ownership
      check in `/api/v1/iap/verify` no longer fires — and a **different account**
      presenting that same JWS gets bound to the subscription.

  The user *is* warned first, and `subscriptionNotice()` is well written and
  sits above the confirm field. They ignore it, as people do.

  ── Why this table holds no PII, deliberately ──────────────────────────────

  `original_transaction_id` is **Apple's identifier for a billing relationship**,
  not ours and not a person's. It is not an email, a name, a device or a user
  id — it cannot be used to contact anybody or to look anything up in this
  product, because the account it referred to no longer exists.

  That is what makes keeping it compatible with a privacy policy that calls
  deletion complete: nothing here identifies the deleted user. What it does is
  let a support conversation that *starts* with the customer ("Apple is still
  charging me") be reconciled against a record, and let a genuine re-purchase
  reclaim its own history.

  ⚠ It deliberately does **not** carry `user_id`. A deleted account's id in a
  surviving table is the thing the deletion promise is about.
*/

CREATE TABLE IF NOT EXISTS orphaned_apple_subscriptions (
  /*
    Apple's own key for the billing relationship, and the primary key here.
    A second orphaning of the same subscription — deleted, re-purchased,
    deleted again — updates rather than duplicating, because there is only ever
    one live billing relationship behind it.
  */
  original_transaction_id text PRIMARY KEY,
  product_id text,
  /* What the entitlement said when the account went. */
  tier text,
  expires_at timestamptz,
  environment text,
  orphaned_at timestamptz NOT NULL DEFAULT NOW(),
  /*
    Set when a later purchase claims this subscription back, so the row records
    a resolved case rather than being deleted — a support conversation about a
    subscription that was reclaimed still needs the row to explain what
    happened.
  */
  reclaimed_at timestamptz
);

COMMENT ON TABLE orphaned_apple_subscriptions IS
  'Apple subscriptions whose owning account was deleted. Contains no PII: original_transaction_id is Apple''s billing identifier, not a person''s. See IAP-05 and lib/account-data.ts.';

ALTER TABLE orphaned_apple_subscriptions ENABLE ROW LEVEL SECURITY;

/*
  ── ⚠ No policy at all, and that is the design ─────────────────────────────

  RLS is enabled and **nothing is granted**, so with no policy the table is
  unreachable by `anon` and `authenticated` alike — only the service role,
  which bypasses RLS, can see it.

  That is right for this table: there is no user it belongs to, by construction.
  A `SELECT` policy would have to key on something, and the only candidate is
  the transaction id, which would make the table a lookup oracle for
  "is this subscription orphaned" to anyone who could guess one.

  `20260812120000` makes the same argument for `account_entitlements` — grant
  nothing rather than write a policy and hope it is narrow enough.
*/
REVOKE ALL ON orphaned_apple_subscriptions FROM anon;
REVOKE ALL ON orphaned_apple_subscriptions FROM authenticated;

/* The lookup a reclaim does: "has this transaction been orphaned and not yet claimed". */
CREATE INDEX IF NOT EXISTS orphaned_apple_subscriptions_unreclaimed_idx
  ON orphaned_apple_subscriptions (original_transaction_id)
  WHERE reclaimed_at IS NULL;
