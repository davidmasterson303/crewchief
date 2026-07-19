/*
  # Add Powertrain Options Fields to vehicle_knowledge_base

  1. New Columns
    - `engine_options` (jsonb) - Array of viable engine configurations
    - `transmission_options` (jsonb) - Array of viable transmission types
    - `drivetrain_options` (jsonb) - Array of viable drivetrain configurations

  2. Purpose
    - Store pre-parsed powertrain options from LLM research
    - Enable dropdown selection during onboarding instead of free-text input
    - Prevent redundant LLM calls for the same vehicle variant

  3. Format
    - Each array contains strings like:
      - Engine: "2.0L Turbo I4", "3.5L V6 N/A"
      - Transmission: "6-speed Manual", "8-speed Automatic"
      - Drivetrain: "FWD", "RWD", "AWD", "4WD"

  4. Default
    - Empty arrays [] if no options found or generated
*/

ALTER TABLE vehicle_knowledge_base
ADD COLUMN IF NOT EXISTS engine_options jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS transmission_options jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS drivetrain_options jsonb DEFAULT '[]'::jsonb;
