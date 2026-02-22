-- Migration: Add confirmation fields to transfers table
-- For secure proof upload and confirmation tracking

ALTER TABLE transfers 
ADD COLUMN IF NOT EXISTS proof_file_path VARCHAR(500),
ADD COLUMN IF NOT EXISTS confirmation_comment TEXT,
ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS confirmation_ip VARCHAR(50);

-- Update status enum to include 'confirmed'
ALTER TABLE transfers 
DROP CONSTRAINT IF EXISTS transfers_status_check;

ALTER TABLE transfers 
ADD CONSTRAINT transfers_status_check 
CHECK (status IN ('pending', 'in_progress', 'paid', 'confirmed', 'cancelled'));

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_transfers_confirmed_at ON transfers(confirmed_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_proof_file ON transfers(proof_file_path) WHERE proof_file_path IS NOT NULL;
