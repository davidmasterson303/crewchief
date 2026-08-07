/*
  # Remember where to send a notification

  Phase 5's missing half. The device side shipped on 5 Aug — permission,
  foreground handling, tap routing through the deep-link table, cold-start
  recovery — and it can do nothing, because **nothing knows where to send a
  push.** This is the table that closes that.

  ## What is stored, and what is deliberately not

  A push token, the account it belongs to, and enough to retire it:

    user_id · expo_push_token · device_id · platform · last_registered_at

  **No device name, no model, no OS version, no locale.** All of it is
  available from `expo-device` and none of it is needed to deliver a
  notification. A table that accumulates a fleet inventory of someone's
  hardware is a table that has to be explained in a privacy label, and the
  feature works identically without it.

  **No notification history.** What was sent and whether it was opened is a
  separate question with a separate retention answer; recording it here would
  make this table grow without bound for a feature that only ever reads the
  newest row per device.

  ## Why the unique key is (user_id, device_id) and not the token

  **Expo push tokens rotate.** They change on reinstall, on restore to a new
  phone, and occasionally on OS upgrade. Keying on the token means every
  rotation leaves a dead row behind, and dead rows are how a "notify all my
  devices" query starts sending to handsets that were traded in a year ago.

  `device_id` is stable for an install, so a rotation *updates* rather than
  inserts. The upsert target is named here because the app has been bitten by
  an `ON CONFLICT` naming a constraint that did not exist —
  `mod-details-goal-key.test.ts` exists because of that.

  ## Why a token is not a secret, and is still protected

  An Expo push token addresses a device; it does not authenticate anyone. But
  it is enough to *send* to that device, so a leaked table is a spam channel
  wearing CrewChief's name. Rows are readable only by their owner, and only the
  service role writes — the mobile client registers through `/api/v1/push-token`
  and never touches this table, which is the rule `mobile-api-only.test.ts`
  enforces on the client side.

  ## Deletion

  `ON DELETE CASCADE`. `cc-product-0005` promises immediate account deletion,
  and a surviving push token is the worst kind of leftover: a row that can still
  *reach* someone who asked to be forgotten.

  ## Shape

  CREATE TABLE, one FK, one unique constraint, two indexes, RLS, two policies.
  No DROP, no TRUNCATE — the dashboard's "Potential issue detected" modal will
  not fire.
*/

CREATE TABLE IF NOT EXISTS public.device_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  /*
    CASCADE, so a deleted account cannot still be pushed to. See the header:
    of everything that could survive a deletion, a delivery address is the
    one that most obviously must not.
  */
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  /*
    `ExponentPushToken[…]`. text rather than a narrower type: the format is
    Expo's to change, and a CHECK on its shape would turn their release note
    into our outage.
  */
  expo_push_token text NOT NULL,

  /*
    Stable for the lifetime of an install. The rotation key — see the header
    for why this and not the token itself.
  */
  device_id text NOT NULL,

  platform text NOT NULL DEFAULT 'ios',

  created_at timestamptz NOT NULL DEFAULT now(),

  /*
    Touched on every registration, not only on change. It is the only signal
    available for retiring a device that stopped opening the app — a token
    nobody has re-registered in months is almost certainly gone, and Expo's
    receipts are the other half of that answer.
  */
  last_registered_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT device_push_tokens_platform_known
    CHECK (platform IN ('ios', 'android')),

  /*
    The upsert target, named so a caller can rely on it. One row per device per
    account: re-registering the same handset rotates its token in place rather
    than accumulating.
  */
  CONSTRAINT device_push_tokens_one_per_device UNIQUE (user_id, device_id)
);

/*
  The send query: "every live token for this account". Without it a fan-out
  scans the table once per notification.
*/
CREATE INDEX IF NOT EXISTS device_push_tokens_user_idx
  ON public.device_push_tokens (user_id);

/*
  The retirement sweep, which reads oldest-first. Separate from the index above
  because it is ordered rather than filtered.
*/
CREATE INDEX IF NOT EXISTS device_push_tokens_last_registered_idx
  ON public.device_push_tokens (last_registered_at);

ALTER TABLE public.device_push_tokens ENABLE ROW LEVEL SECURITY;

/*
  Scoped to the owner, never blanket. `rls-blanket-policies.test.ts` exists
  because `USING (true)` on a neighbouring table nullified every scoped policy
  beside it — policies are OR'd, so one permissive rule opens the whole table.
*/
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'device_push_tokens'
      AND policyname = 'Users read only their own device tokens'
  ) THEN
    CREATE POLICY "Users read only their own device tokens"
      ON public.device_push_tokens
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

/*
  Deletion is the owner's to perform — signing out of a device, or turning
  notifications off, should stop delivery immediately rather than waiting for a
  sweep. Writes stay with the service role: the client registers through
  `/api/v1/push-token`, which authorizes and is the only path that inserts.
*/
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'device_push_tokens'
      AND policyname = 'Users retire their own device tokens'
  ) THEN
    CREATE POLICY "Users retire their own device tokens"
      ON public.device_push_tokens
      FOR DELETE
      TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;
