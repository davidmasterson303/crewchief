/*
  # Remember which recalls we have already raised

  Phase 5.6. `device_push_tokens` records *where* to send; this records *what we
  have already said*, which is the other half of not being a nuisance.

  ## The failure this prevents

  Recall notification is a polling feature: something re-reads NHTSA on a
  schedule and compares. Without a record of what was sent, **every poll
  re-notifies every open recall on every vehicle** — a car with three recalls
  produces three pushes an hour, forever, about work the owner may have had done
  a year ago. That is not a degraded feature, it is the feature actively
  training people to disable notifications, and it takes the one recall that
  matters with it.

  ## Why a table rather than a timestamp comparison

  `nhtsa_data.last_checked` already exists, and "notify about anything with a
  report date newer than the last check" needs no new schema at all. It was the
  first design and it is wrong in a way that only shows up in production: the
  poll updates `last_checked` whether or not the send succeeded. One failed
  delivery — Expo down, a token mid-rotation, the process killed between the two
  writes — and that recall is permanently in the past. It is never raised again,
  and nothing anywhere reports that it was missed.

  A row written *after* a successful send cannot lose a notification to a failed
  one. The cost is a table; the alternative silently drops safety notices.

  ## Keyed on the vehicle, not the account

  A recall is a fact about a car. Keying on `(user_id, campaign)` would re-raise
  every recall if a vehicle changed hands within the app, which sounds correct
  and is not — the new owner needs the notice, but they need it because the car
  is theirs now, and that is a decision for whoever builds vehicle transfer.
  Until that exists, `(vehicle_id, campaign_number)` is the honest key.

  `ON DELETE CASCADE` for the same reason as `device_push_tokens`: a deleted
  vehicle should not leave rows that shape what a future one is told.

  ## Shape

  CREATE TABLE, one FK, one unique constraint, one index, RLS, one policy.
  No DROP, no ALTER of an existing table — the dashboard's "Potential issue
  detected" modal will not fire. If it does, the wrong SQL is in the editor.
*/

CREATE TABLE IF NOT EXISTS public.recall_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,

  /*
    NHTSA's campaign number — `20V123000`. Their identifier, not ours, because
    the thing being deduplicated is *their* notice. A hash of the summary would
    re-notify every time NHTSA corrected a typo.
  */
  campaign_number text NOT NULL,

  /*
    Written after a successful send, never before. See the header: recording
    the intent rather than the outcome is how a failed delivery becomes a
    permanently suppressed notice.
  */
  notified_at timestamptz NOT NULL DEFAULT now(),

  /*
    What the owner was told, at the time they were told it. NHTSA revises
    severity — a recall can be upgraded to "do not drive" weeks after it is
    issued — and an upgrade is worth raising again even though the campaign
    number has not changed. Storing what we last said is what makes that
    comparison possible.
  */
  severity text NOT NULL DEFAULT 'standard',

  CONSTRAINT recall_notifications_severity_known
    CHECK (severity IN ('standard', 'park-outside', 'do-not-drive')),

  /* The dedupe key, named so the upsert can rely on it. */
  CONSTRAINT recall_notifications_one_per_campaign UNIQUE (vehicle_id, campaign_number)
);

/* "What have we already told this owner about this car" — the read on every poll. */
CREATE INDEX IF NOT EXISTS recall_notifications_vehicle_idx
  ON public.recall_notifications (vehicle_id);

ALTER TABLE public.recall_notifications ENABLE ROW LEVEL SECURITY;

/*
  Scoped through the vehicle's owner, never blanket. `rls-blanket-policies.test.ts`
  exists because a `USING (true)` on a neighbouring table nullified every scoped
  policy beside it — policies are OR'd, so one permissive rule opens the table.
*/
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'recall_notifications'
      AND policyname = 'Users read recall notices for their own vehicles'
  ) THEN
    CREATE POLICY "Users read recall notices for their own vehicles"
      ON public.recall_notifications
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.vehicles v
          WHERE v.id = recall_notifications.vehicle_id
            AND v.user_id = auth.uid()
        )
      );
  END IF;
END $$;

/*
  No INSERT, UPDATE or DELETE policy, deliberately. Only the service role writes
  here, from the polling path. A client that could delete its own rows could
  make a recall notice re-fire on every poll; a client that could insert them
  could suppress one permanently. Neither is a capability an owner needs, and
  the second is the dangerous one.
*/
