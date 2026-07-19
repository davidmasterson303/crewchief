/*
  # Add Session Support to Consultant Conversations

  1. Changes
    - Add `title` column to `consultant_conversations` to support multiple named sessions per vehicle
    - Update existing conversations to have a "Legacy Chat" title
    - Add index on vehicle_id for faster session lookups
    - Remove unique constraint on vehicle_id to allow multiple sessions per vehicle

  2. Notes
    - Existing conversations are preserved as "Legacy Chat"
    - New conversations can now be created with custom titles
    - Each vehicle can have multiple conversation sessions
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'consultant_conversations' AND column_name = 'title'
  ) THEN
    ALTER TABLE consultant_conversations ADD COLUMN title text DEFAULT 'Chat Session';
  END IF;
END $$;

UPDATE consultant_conversations
SET title = 'Legacy Chat'
WHERE title = 'Chat Session' AND message_history IS NOT NULL AND jsonb_array_length(message_history) > 0;

CREATE INDEX IF NOT EXISTS idx_consultant_conversations_vehicle_created ON consultant_conversations(vehicle_id, created_at DESC);