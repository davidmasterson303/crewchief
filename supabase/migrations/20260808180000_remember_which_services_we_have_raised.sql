/*
  # Remember which services we have already raised

  Phase 5, C3. **Additive only** — one new table. Nothing is dropped and no
  existing row changes.

  ## Why recalls needed a different shape

  `20260807120000` dedupes recalls on NHTSA's campaign number, because a recall
  is a discrete event with a stable identifier: it either has been mentioned or
  it has not, forever.

  **A service is not an event, it is a condition.** Oil due at 92,500 miles
  stays due until it is done — for weeks, and at this product's own average of
  ~1,200–1,600 miles a month, potentially for months. So there is no "have we
  mentioned this one" to answer; the question is "when did we last say
  anything about this car", and the dedupe key is time rather than identity.

  Which is why this is one row per vehicle, upserted, rather than one row per
  service.

  ## Why not a column on `vehicles`

  It would work and it would be smaller. It is a separate table because
  `vehicles` is read on every garage load by both clients and is already wide,
  while this is written only by an unattended sweep and read only by the same
  sweep. Keeping the write path off the hot read path also means a bug here
  cannot make the garage fail to load — which matters more than usual for a
  table whose only writer runs at 3am with nobody watching.

  ## What it deliberately does not store

  No message body, no service name, no count. Storing what was said invites
  reading it back to decide what to say next, and that decision belongs to
  `evaluateSchedule` against live mileage — not to a log of what a previous
  sweep believed three weeks ago.
*/

CREATE TABLE IF NOT EXISTS public.service_notifications (
  vehicle_id uuid PRIMARY KEY
    REFERENCES public.vehicles(id) ON DELETE CASCADE,

  /*
    `timestamptz`, not `date`. The sweep compares this to "today" after
    truncating to a day (`daysBetween` in notification-sweep.ts slices to 10
    characters), so the extra precision is never used for the comparison — but
    a bare `date` throws away the one thing that makes an unexpected send
    debuggable, which is what time it actually went out.
  */
  last_notified_at timestamptz NOT NULL DEFAULT now(),

  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.service_notifications IS
  'One row per vehicle: when a service-due push was last sent for it. The '
  'cooldown lives in packages/core/src/notification-sweep.ts '
  '(SERVICE_COOLDOWN_DAYS), not here — a schedule that stays due must not '
  'produce a nightly notification.';

/*
  RLS on, and **no policy granting anything**.

  Deliberate, and not an oversight: nothing outside the sweep has any business
  reading or writing this, and the sweep uses the service role, which bypasses
  RLS. A table with RLS enabled and no policy denies every anon and
  authenticated request by default — which is exactly the intent.

  `rls-blanket-policies.test.ts` exists because this repo shipped `USING (true)`
  more than once. The safe shape here is no policy at all.
*/
ALTER TABLE public.service_notifications ENABLE ROW LEVEL SECURITY;
