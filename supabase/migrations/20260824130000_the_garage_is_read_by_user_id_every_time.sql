/*
  There is no index on `vehicles.user_id`.

  ── ⚠ DB-08, from the 24 Aug QA audit ──────────────────────────────────────

  Every RLS policy on `vehicles` evaluates `user_id = auth.uid()`, so **every
  read of a garage is a sequential scan** over the whole table. And the
  `storage.objects` policies do a subquery against this table **per object
  listed**, so listing an owner's invoice images is one scan per file.

  Invisible at four rows. It is the shape of defect that is invisible until it
  is not, and the moment it stops being invisible is the moment there are enough
  users to care about — which is the worst time to discover it.

  ── Why this migration is safe to run without reading the database first ────

  Everything else in the DB lane is a policy change derived from **replaying the
  migration corpus**, and `CLAUDE.md` §2 records that the corpus and the live
  database have disagreed five times in both directions. Dropping and recreating
  a policy from a stale map is how a correct policy gets regressed.

  An index is different: `CREATE INDEX IF NOT EXISTS` is additive, idempotent,
  and changes no behaviour whatever the current state is. It is the one DB
  finding that does not need `scripts/sql/reconcile-rls-2026-08-24.sql` to have
  been run first.

  ⚠ Not `CONCURRENTLY`. Supabase runs migrations inside a transaction and
  `CREATE INDEX CONCURRENTLY` cannot run in one. At this table's size the brief
  lock is nothing; if it ever is not, this is a statement to run by hand rather
  than a migration to rewrite.
*/

CREATE INDEX IF NOT EXISTS vehicles_user_id_idx ON vehicles (user_id);

COMMENT ON INDEX vehicles_user_id_idx IS
  'Every RLS check on this table is user_id = auth.uid(), and storage.objects subqueries against it per object listed. See DB-08.';
