/*
  # Store each car's next service on the vehicle

  **Additive. Three nullable columns, no data touched, no policy changed.**

  ⚠ This header makes **no prediction about the "Potential issue detected"
  modal.** Four headers have now predicted it and all four were wrong — three
  said it would stay quiet and it fired, `20260813020000` said it would fire and
  it did not. It is a vendor heuristic this repo has no model of. What is
  knowable is stated above: this migration is additive.

  ## Why the answer is stored rather than computed

  The garage bay wants one line per car — *"Next service · Oil & filter · in
  420 mi"*. Computing it needs the maintenance schedule, which lives in
  `vehicle_knowledge_base.maintenance_schedule` as a JSON dossier that
  `/api/v1/vehicles` does not join at all.

  Adding that join is the obvious fix and the expensive one: it pulls a whole
  schedule array **for every car in the garage**, on every list load and every
  pull-to-refresh, to render one short string per card. Today that is one real
  vehicle and the cost is invisible. At ten cars it is ten dossiers over a
  mobile connection for ten strings.

  `docs/step4-api-gaps.md` §3 sets out the alternative — a `garage_next_service`
  view doing the join server-side — and why it is not the starting point: it
  moves the cost rather than removing it.

  ## Who writes it

  `notify-sweep` already loads each vehicle's schedule and already calls
  `evaluateSchedule`, then throws the result away unless a notification is
  raised. The write-back happens **before** that raise gate, deliberately: put
  it after and only the cars that earned a notification would ever have a stored
  next service, which is a subtle way of leaving most of the garage blank.

  ## ⚠ The staleness this accepts, stated plainly

  The value is as fresh as the last sweep, so a mileage update entered at noon
  shows yesterday's next service until 17:00 UTC.

  On the garage summary card that is fine — it is a glance, and vehicle detail
  computes live from the real schedule. It would **not** be fine on a screen
  telling someone whether to drive the car, and this must not become the source
  for one.

  `next_service_updated_at` exists so a reader can tell how stale it is rather
  than having to trust it. A row whose timestamp is days old means the sweep has
  not run, which is worth surfacing rather than hiding behind a confident label.

  ## ⚠ Amended 16 Aug, before ever being applied

  A fourth column, `next_service_due_on`, was added while building the row this
  migration exists for. The original three could not express the most ordinary
  time-driven case: brake fluid has no mileage interval, so `next_service_label`
  would store "Brake fluid" and `next_service_at_miles` would be null, leaving
  the card able to name the service but not to say **when**.

  That is worse than saying nothing. "Brake fluid" under a heading reading "Next
  service", with no timing after it, reads as *now* — the loudest claim the row
  can make, arrived at by accident. `describeNextService` refuses to render it
  and returns `unknown`, which would have made every time-driven car fall into
  the empty state.

  Amended in place rather than followed by a second migration because **this one
  has never run** — verified against the live database, not inferred from this
  folder: `select next_service_label` returns `42703, column does not exist`.

  ## ⚠ Sequencing — read before deploying

  **Nothing selects these columns yet, on purpose.** Adding them to
  `GARAGE_COLUMNS` before this migration is applied would make
  `/api/v1/vehicles` error on an unknown column and take the whole garage down
  for everyone. The endpoint and the bay's row are a follow-up, gated on this
  landing.

  ## Verification

  Should return four rows:

      SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'vehicles'
         AND column_name LIKE 'next_service%';
*/

ALTER TABLE public.vehicles
  /* The headline service — "Engine oil and filter". Wording comes from the
     knowledge base's own schedule entry, never composed here. */
  ADD COLUMN IF NOT EXISTS next_service_label text,
  /* The odometer reading it falls due at.

     ⚠ **Null is a real answer, not missing data.** A service driven purely by a
     date — brake fluid, most commonly — has no mileage to name it after, and
     `nextMilestone` already refuses to invent one. A reader must render the
     null case as a date or as nothing, never as zero miles. */
  ADD COLUMN IF NOT EXISTS next_service_at_miles integer,
  /* When the sweep last wrote the two above. Lets a reader judge the staleness
     rather than trust it — see the note on freshness. */
  /* The date it falls due, for a service the schedule times by calendar rather
     than by odometer.

     ⚠ **Exactly one of this and `next_service_at_miles` should be set.** The
     schedule's own rule is "whichever comes first", and the sweep applies it —
     by the time a row is written the choice is made. A row carrying both is the
     sweep failing to decide, and the reader prefers mileage rather than trying
     to reconcile them.

     `date`, not `timestamptz`. This names a calendar day with no time in it,
     and giving it a zone is how "due Sep 1" becomes "due Aug 31" for every
     owner west of Greenwich. */
  ADD COLUMN IF NOT EXISTS next_service_due_on date,
  /* When the sweep last wrote the values above. Lets a reader judge the
     staleness rather than trust it — see the note on freshness.

     ⚠ Note that the countdown itself does **not** depend on this.
     `next_service_at_miles` is an absolute odometer reading, so "in 420 mi" is
     recomputed against live mileage on every read and corrects itself as the
     car is driven. Had the column held a remainder, this timestamp would have
     been load-bearing rather than informational. */
  ADD COLUMN IF NOT EXISTS next_service_updated_at timestamptz;
