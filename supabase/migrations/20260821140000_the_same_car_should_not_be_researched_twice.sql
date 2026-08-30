/*
  # The same car should not be researched twice

  Phase 5.1 cost control, 21 Aug. **Additive only** — one new table. Nothing is
  dropped, no existing row changes, no existing policy or grant is touched. The
  "Potential issue detected" modal should NOT fire on this one.

  ⚠ Written, not applied. Applying is Cowork's/David's.

  ## What this is for

  Three weeks of metering (`ai_usage_events`, 2–21 Aug) put
  `modification_details` at **89% of all AI spend** — 232 calls of 292, and
  $2.02 of $2.26. It was also the only Gemini path in the product with **no
  cache at any level**: every time anyone opened a modification, the analysis
  was generated again from scratch.

  It is simultaneously the most cacheable call in the product. Its prompt reads
  six values and not one of them identifies a person or a specific car: year,
  make, model, the modification's name, the performance goal, and the ownership
  objective. "Cold air intake on a 2018 Accord, moderate, keep forever" has one
  answer, and it is the same answer for every owner of that car.

  ⚠ **`performance_mod_cache` does not already do this.** It caches the mod
  *list*, and it is keyed on `vehicle_id` — so two people with identical cars
  share nothing, and the details were never cached at all.

  ## Why the key is content, not a vehicle id

  Keying on `vehicle_id` is what makes the existing cache unable to help a
  second owner. This one is keyed on the *content of the question*, computed by
  `modDetailCacheKey` in `@wellkept/core/mod-detail-cache`, so the first person
  to open a mod on a 2018 Accord pays for it and everybody after them does not.

  ⚠ The key must contain **every value the prompt interpolates**. A key narrower
  than the prompt serves one car's answer for another's — and that failure is
  silent and confident: a fluent, specific analysis of the wrong vehicle, with
  no error anywhere. `mod-detail-cache.test.ts` pins the field list against the
  prompt so a new input cannot be added without also widening the key.

  ## Service role only, and why that is not the entitlements argument

  `account_entitlements` is service-role-write-only because a user-writable
  entitlement is a free subscription. This table is not revenue, and the reason
  here is narrower: a client-writable cache is a way to make the product give
  every other owner of your car whatever text you like. The blast radius is
  wrong answers rather than lost money, which is still not a thing to leave
  open.

  `anon` gets nothing. The demo reads modifications through server actions that
  hold the service-role client, so nothing client-side needs to see this table.

  ## The TRUNCATE rule

  `20260801150000` revoked TRUNCATE from `authenticated` across the schema, and
  that grant does not extend to tables created afterwards — `20260813020000`
  had to reach four newer tables for exactly this reason. So this migration
  carries its own REVOKE rather than inheriting one, and
  `truncate-revoked.test.ts` fails the build if it does not.
*/

CREATE TABLE IF NOT EXISTS public.mod_detail_cache (
  -- `modDetailCacheKey(facts)` — year, make, model, mod name, performance goal
  -- and ownership objective, normalised and joined. Human-readable rather than
  -- hashed, because somebody debugging a wrong answer needs to read it.
  cache_key text PRIMARY KEY,

  -- The generated analysis, exactly as the model returned it.
  details jsonb NOT NULL,

  -- The inputs, stored alongside the key. Redundant with it by design: the key
  -- is normalised and lossy, and a support conversation starts with "which car
  -- was this?" rather than with a separator-joined string.
  year integer,
  make text,
  model text,
  mod_name text,
  performance_goal text,

  cached_at timestamptz NOT NULL DEFAULT now(),

  -- How often this row saved a call. Not load-bearing; it is the cheapest way
  -- to find out whether the cache is worth having, which is a question this
  -- project has been wrong about before.
  hit_count integer NOT NULL DEFAULT 0
);

-- Freshness is checked on every read (30-day window, see the core module), so
-- the age column is worth an index for the eventual sweep of stale rows.
CREATE INDEX IF NOT EXISTS mod_detail_cache_cached_at_idx
  ON public.mod_detail_cache (cached_at);

ALTER TABLE public.mod_detail_cache ENABLE ROW LEVEL SECURITY;

/*
  No policy at all, deliberately.

  RLS is enabled and nothing is granted, so `authenticated` and `anon` cannot
  reach this table by any path. The service role bypasses RLS, which is the
  only access this table needs. A SELECT policy would be harmless today and is
  still not written: the moment one exists, somebody adds `FOR ALL` to it.
*/
REVOKE ALL ON public.mod_detail_cache FROM anon;
REVOKE ALL ON public.mod_detail_cache FROM authenticated;

COMMENT ON TABLE public.mod_detail_cache IS
  'Modification analyses keyed on the content of the question rather than a vehicle id, so two owners of the same car generate it once. Service role only.';

COMMENT ON COLUMN public.mod_detail_cache.cache_key IS
  'modDetailCacheKey() — must contain every value the prompt interpolates. A narrower key serves one car''s answer for another''s, silently.';
