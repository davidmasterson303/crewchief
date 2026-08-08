/*
  # The front door spends on its own line

  ## Why a new purpose rather than reusing `invoice_extraction`

  The anonymous quote check (Phase 2.97b, decision D9) is a different feature
  from the signed-in invoice scan, not the same feature with different traffic:

  - a different prompt, and a different output — a range, not line items;
  - no vehicle, no account, no dossier;
  - **a set thinking level.** `parseInvoiceLineItems` is deliberately the one
    remaining 3.x call site left at the model default, on the argument that
    nothing measures whether cutting its thinking would cost accuracy. That
    argument does not transfer to an unauthenticated endpoint, where default
    thinking is the money faucet 2.95a was built to close.

  `surface` already separates whose traffic it was. It does not answer which
  feature spent the money, and the cost reports ask both.

  ## This has to land before the code that writes it

  `recordAiUsage` is fire-and-forget: a rejected INSERT is a warn line and a
  missing row. So shipping `quote_check` in the application before this
  constraint accepts it produces **a front door that is silently unmetered** —
  the one surface whose cost is least predictable and most needs watching.

  `ai-usage.test.ts` fails the build if the application knows a purpose
  the database refuses, which is what makes that ordering enforceable rather
  than remembered.

  ## Pure addition

  One CHECK swapped for a superset of itself. No DROP TABLE, no TRUNCATE, no
  data touched — the dashboard's "Potential issue detected" modal will not fire.
  The constraint has to be dropped and recreated because Postgres has no
  "extend a CHECK" verb; the drop is of the *constraint*, not of anything
  holding data, and it is immediately replaced inside the same transaction.
*/

-- ─── The vocabulary, extended ─────────────────────────────────────────────────
--
-- Wrapped in a transaction so there is no instant where the table has no
-- purpose constraint at all. Without it, a concurrent write during the gap
-- could insert a value the new constraint then rejects, leaving a row that
-- cannot be updated without violating it.

BEGIN;

ALTER TABLE public.ai_usage_events
  DROP CONSTRAINT IF EXISTS ai_usage_events_purpose_check;

ALTER TABLE public.ai_usage_events
  ADD CONSTRAINT ai_usage_events_purpose_check CHECK (purpose IN (
    'consultant',
    'invoice_extraction',
    'vehicle_dossier',
    'vehicle_health_summary',
    'powertrain_options',
    'modification_details',
    'modification_backfill',
    'performance_stats',
    'health_check',
    -- Phase 2.97b. The only purpose that can arrive with surface = 'anonymous'
    -- by design; everything else reaching that surface would be a bug.
    'quote_check'
  ));

COMMIT;

COMMENT ON CONSTRAINT ai_usage_events_purpose_check ON public.ai_usage_events IS
  'Which feature spent the money. Orthogonal to surface, which says whose traffic it was. Kept in step with AI_USAGE_PURPOSES by ai-usage.test.ts — adding a value here without adding it there, or the reverse, fails the build.';
