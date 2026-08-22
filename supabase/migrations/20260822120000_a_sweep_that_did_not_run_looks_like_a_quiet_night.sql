/*
  # A sweep that did not run looks like a quiet night

  Phase 5 instrumentation, 22 Aug. **Additive only** — one new table. Nothing is
  dropped, no existing row changes, no existing policy or grant is touched. The
  "Potential issue detected" modal should NOT fire on this one.

  ## The question this table exists to answer

  `recall_notifications` had no row newer than **16 August**. Six nights. There
  are exactly two explanations and the database could not tell them apart:

  - the sweep ran every night and correctly decided to send nothing, or
  - the sweep has not run since the 16th.

  A dry run on 22 Aug settled it in this instance — the sweep plans zero sends
  today, so the silence is a quiet week. But settling it needed a person to
  notice, run the route by hand, and read the result. CLAUDE.md §7 is about
  exactly this shape, and the canary is the precedent: it sat on a side branch
  and had never fired once, and the only reason anybody found out was that
  somebody went looking in `ai_usage_events`.

  ⚠ **A monitor that is not running reads as good news.** The sweep's only
  trace today is a `console.log` in Netlify's function logs and whatever
  notifications it happens to send. So its *healthy* state and its *dead* state
  produce identical evidence in the database — which is the property that makes
  a dead monitor survive.

  ## What a row means, and what an empty table means

  One row per run, written at the end, including runs that decided to send
  nothing. That is the point: the boring rows are the evidence.

  - `dry_run = false` is a real run. **"Did the scheduler fire last night?" is
    `select max(finished_at) from sweep_runs where dry_run = false`**, and that
    is the query this table is for.
  - `dry_run = true` rows are somebody diagnosing. Kept, because "who ran what
    by hand" is the other question that comes up, but never counted as the
    scheduler working.
  - `ok = false` records a run that failed after starting. The route's early
    exits — unset secret, wrong secret — write nothing, deliberately: they are
    not runs, and an unauthorized caller must not be able to write rows here.

  ⚠ **An empty table does not prove the sweep did not run.** It proves nothing
  recorded it, and a failed insert has the same shape as a missing invocation.
  The write is failure-tolerant on purpose — a heartbeat that can take the
  sweep down has the priorities backwards — so when it fails it logs at error
  level and the Netlify function log is what separates the two cases. Written
  down because a guard that cries wolf gets made to pass (CLAUDE.md §5), and
  the wolf here would be "the sweep is dead" when the truth is "the table is
  not there yet".

  ## Grants

  `20260801150000` revoked TRUNCATE from `authenticated` across the schema, and
  that grant does not extend to tables created afterwards — Postgres expands
  `ALL TABLES` once. So this migration carries its own REVOKE rather than
  inheriting one, and `truncate-revoked.test.ts` fails the build if it does not.
*/

CREATE TABLE IF NOT EXISTS public.sweep_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- When the run finished. The column the "did it fire" query reads.
  finished_at timestamptz NOT NULL DEFAULT now(),

  -- ⚠ A hand-run diagnosis is not the scheduler working. Filtered on, not
  -- decoration.
  dry_run boolean NOT NULL DEFAULT false,

  -- False when the run started and then failed. Distinct from no row at all,
  -- which means nothing recorded it — see the note above.
  ok boolean NOT NULL DEFAULT true,

  -- Present only when `ok` is false. The route's own message, not the raw
  -- error: this table is read by a person asking "is the sweep alive".
  error text,

  -- The summary the route already computes and logs. Stored so a quiet night
  -- is legible as a decision rather than as an absence: 2 vehicles scanned and
  -- 0 planned is a working sweep, and it is indistinguishable from a dead one
  -- unless the scan count is written down.
  vehicles_scanned integer NOT NULL DEFAULT 0,
  recalls_planned integer NOT NULL DEFAULT 0,
  services_planned integer NOT NULL DEFAULT 0,
  recalls_sent integer NOT NULL DEFAULT 0,
  services_sent integer NOT NULL DEFAULT 0,
  schedules_generated integer NOT NULL DEFAULT 0,
  generation_backlog integer NOT NULL DEFAULT 0,
  capped boolean NOT NULL DEFAULT false
);

-- Every read of this table is "the most recent run", and the real runs and the
-- hand runs are asked about separately.
CREATE INDEX IF NOT EXISTS sweep_runs_finished_at_idx
  ON public.sweep_runs (dry_run, finished_at DESC);

ALTER TABLE public.sweep_runs ENABLE ROW LEVEL SECURITY;

/*
  No policy at all, deliberately — the same shape as `mod_detail_cache`.

  RLS is enabled and nothing is granted, so `authenticated` and `anon` cannot
  reach this table by any path. The service role bypasses RLS, which is the
  only access it needs. A SELECT policy would be harmless today and is still
  not written: the moment one exists, somebody adds `FOR ALL` to it.
*/
REVOKE ALL ON public.sweep_runs FROM anon;
REVOKE ALL ON public.sweep_runs FROM authenticated;

COMMENT ON TABLE public.sweep_runs IS
  'One row per nightly sweep, including runs that sent nothing. Exists so a sweep that stopped running is distinguishable from a quiet week — those two states were previously identical in this database. Service role only.';

COMMENT ON COLUMN public.sweep_runs.dry_run IS
  'True for a hand-run diagnosis. "Did the scheduler fire?" must filter these out, or a person debugging the sweep makes it look alive.';

COMMENT ON COLUMN public.sweep_runs.ok IS
  'False means the run started and failed. No row at all means nothing recorded it, which is not the same claim — the insert is failure-tolerant by design.';
