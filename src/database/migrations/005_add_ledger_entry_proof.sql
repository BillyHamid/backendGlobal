-- Preuve obligatoire pour les entrées d'argent manuelles (CREDIT)
ALTER TABLE ledger_entries
ADD COLUMN IF NOT EXISTS proof_file_path VARCHAR(500);

COMMENT ON COLUMN ledger_entries.proof_file_path IS 'Preuve (photo/PDF) pour les entrées manuelles de caisse';
