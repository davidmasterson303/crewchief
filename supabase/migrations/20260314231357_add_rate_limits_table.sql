/*
  # Add API Rate Limits Table

  ## Purpose
  Implements a sliding-window rate limiting system to prevent API abuse, excessive
  AI spend, and denial-of-service attacks.

  ## New Tables
  - `api_rate_limits`
    - `id` (uuid, primary key)
    - `identifier` (text) — IP address or user ID used as the rate-limit key
    - `endpoint` (text) — the route being rate-limited (e.g., "ai", "upload", "default")
    - `window_start` (timestamptz) — start of the current sliding window
    - `request_count` (int) — number of requests made within this window
    - `created_at` (timestamptz)
    - `updated_at` (timestamptz)

  ## Indexes
  - Composite index on (identifier, endpoint, window_start) for fast lookups

  ## Security
  - RLS enabled; service role only (rate limiting runs server-side with service key)
  - No public access — all writes happen through server-side functions

  ## Notes
  1. Rows are upserted per (identifier, endpoint, window_start) — old windows are
     never updated; new windows create new rows.
  2. Cleanup of expired rows happens via a periodic DELETE in the rate-limit helper.
  3. Tier limits (requests per window) are enforced in application code, not DB.
*/

CREATE TABLE IF NOT EXISTS api_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  endpoint text NOT NULL DEFAULT 'default',
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup
  ON api_rate_limits (identifier, endpoint, window_start);

CREATE INDEX IF NOT EXISTS idx_rate_limits_cleanup
  ON api_rate_limits (window_start);

ALTER TABLE api_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage rate limits"
  ON api_rate_limits
  FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Service role can insert rate limits"
  ON api_rate_limits
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update rate limits"
  ON api_rate_limits
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can delete rate limits"
  ON api_rate_limits
  FOR DELETE
  TO service_role
  USING (true);
