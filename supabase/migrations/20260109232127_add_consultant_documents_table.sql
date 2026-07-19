/*
  # Add Consultant Documents Table
  
  1. New Table
    - `consultant_documents`
      - Links documents to consultant chat sessions
      - Stores file metadata (url, name, type, size)
      - Includes AI validation results (is_car_related, validation_notes)
      - Tracks upload timestamp
  
  2. Security
    - Enable RLS on consultant_documents table
    - Add permissive policies for MVP (matching other tables)
  
  3. Important Notes
    - Documents are linked to specific consultant sessions, not just vehicles
    - AI validation determines if document is automotive-related
    - Rejected documents are deleted immediately
*/

-- Create consultant_documents table
CREATE TABLE IF NOT EXISTS consultant_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES consultant_conversations(id) ON DELETE CASCADE NOT NULL,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE NOT NULL,
  file_url text NOT NULL,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size int NOT NULL,
  is_car_related boolean DEFAULT true,
  validation_notes text,
  document_type text,
  uploaded_at timestamptz DEFAULT now()
);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_consultant_documents_session_id ON consultant_documents(session_id);
CREATE INDEX IF NOT EXISTS idx_consultant_documents_vehicle_id ON consultant_documents(vehicle_id);

-- Enable Row Level Security
ALTER TABLE consultant_documents ENABLE ROW LEVEL SECURITY;

-- Create permissive policy for MVP (matching other tables)
CREATE POLICY "Allow all operations on consultant_documents" 
  ON consultant_documents 
  FOR ALL 
  USING (true) 
  WITH CHECK (true);
