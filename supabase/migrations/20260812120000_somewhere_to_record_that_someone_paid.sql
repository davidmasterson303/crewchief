/*
  # Somewhere to record that someone paid

  Phase 6, E7. **Additive only** — one new table. Nothing is dropped, no
  existing row changes, and no existing policy is touched. The "Potential issue
  detected" modal should NOT fire on this one.

  ## What was missing

  `resolveTier()` has returned `TIERS.free` unconditionally since it was
  written, because there was nowhere to look. That was a deliberate placeholder
  — its own docblock says it is a function rather than a constant so the call
  sites would already be the right shape — and it means the product currently
  has no way to know that anybody has bought anything.

  It is the dependency under most of Track E: Apple IAP needs somewhere to
  record what it sold, the upgrade prompt needs something to point at, and
  deleting an account with a live subscription needs to know there is one.

  ## Why the shape is Apple's

  A subscription is not a boolean and it is not a date we control.

  `original_transaction_id` is Apple's identifier for a subscription across
  every renewal, so it — not the latest transaction — is what identifies the
  thing being renewed. It is UNIQUE because two accounts sharing one is either
  a bug or account sharing, and both should fail loudly at the write rather
  than quietly grant two entitlements.

  `expires_at` moves every period. We are told about renewals and lapses
  asynchronously, through App Store Server Notifications, rather than at the
  moment somebody uses the app — so the honest record is "entitled until X" and
  every read compares against the clock. A stored boolean would be wrong from
  the instant a renewal failed until the moment we heard about it.

  NULL `expires_at` means an entitlement with no expiry — a comped account or a
  support gesture. It is distinguishable from a lapse because a lapse writes a
  date in the past, never a null.

  ## The security property, which is the whole point of the table

  **`authenticated` gets SELECT on its own row and nothing else.** No INSERT, no
  UPDATE, no DELETE, for anybody but the service role.

  A user who can write their own entitlement row can grant themselves the paid
  tier, which makes the subscription decorative. This is the one table in the
  product where a permissive write policy is not a data-exposure bug but a
  revenue bug, and it would look exactly like working code.

  SELECT is granted because the client legitimately needs to render "your
  subscription renews on the 14th" without a round trip through a route. It
  exposes nothing the account holder does not already know.
*/

CREATE TABLE IF NOT EXISTS public.account_entitlements (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 'free' | 'paid'. Stored as text rather than an enum so adding a tier is a
  -- CHECK change rather than a type migration; the CHECK is what keeps it
  -- honest. Anything unrecognised is read as 'free' by `resolveEntitledTier`.
  tier text NOT NULL DEFAULT 'free',

  -- Apple's stable identifier for the subscription across renewals.
  original_transaction_id text UNIQUE,

  -- The App Store product identifier that was purchased.
  product_id text,

  -- End of the current paid period. NULL means no expiry, not expired.
  expires_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT account_entitlements_tier_check CHECK (tier IN ('free', 'paid'))
);

-- Reads are always "this user's entitlement", which the primary key already
-- serves. The one other access pattern is Apple's notification arriving with a
-- transaction id and no user, which the UNIQUE constraint indexes.
CREATE INDEX IF NOT EXISTS account_entitlements_expires_at_idx
  ON public.account_entitlements (expires_at)
  WHERE expires_at IS NOT NULL;

ALTER TABLE public.account_entitlements ENABLE ROW LEVEL SECURITY;

/*
  One policy, SELECT only, scoped to the owner.

  Deliberately NOT written as FOR ALL with a USING clause. `FOR ALL` plus
  `USING (auth.uid() = user_id)` reads as "users manage their own row" and is
  the shape most of this schema uses — and here it would let any signed-in user
  UPDATE their own tier to 'paid'. The narrow grant is the point.
*/
DROP POLICY IF EXISTS "Users read their own entitlement" ON public.account_entitlements;
CREATE POLICY "Users read their own entitlement"
  ON public.account_entitlements
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Belt to the policy's braces: no write privilege exists to be governed by a
-- policy in the first place. `anon` gets nothing at all — an unauthenticated
-- caller has no entitlement to read and no business knowing the table is here.
REVOKE ALL ON public.account_entitlements FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.account_entitlements FROM authenticated;
GRANT SELECT ON public.account_entitlements TO authenticated;

COMMENT ON TABLE public.account_entitlements IS
  'What an account is entitled to and until when. Written only by the service role — a user-writable entitlement is a free subscription.';
