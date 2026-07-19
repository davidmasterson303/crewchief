/*
  # Add Vehicle Health Summary

  1. New Tables
    - `vehicle_health_summary`
      - Cached AI-generated health summaries for each vehicle
      - Includes overall health score, summary, red flags
      - Tracks when summary was last generated
      - Auto-updates based on maintenance history changes

  2. Security
    - Enable RLS on new table
    - Permissive policies for MVP
*/

CREATE TABLE IF NOT EXISTS vehicle_health_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE NOT NULL UNIQUE,
  health_score integer CHECK (health_score >= 1 AND health_score <= 100),
  summary text,
  red_flags text[],
  maintenance_status text,
  recall_status text,
  issues_overview text,
  recommendations text[],
  last_generated timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_health_summary_vehicle_id ON vehicle_health_summary(vehicle_id);

ALTER TABLE vehicle_health_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on vehicle_health_summary" ON vehicle_health_summary FOR ALL USING (true) WITH CHECK (true);
