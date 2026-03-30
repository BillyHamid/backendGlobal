-- Scan / photo de pièce d'identité bénéficiaire (nouveau transfert)

ALTER TABLE beneficiaries
ADD COLUMN IF NOT EXISTS id_proof_filename VARCHAR(500);

COMMENT ON COLUMN beneficiaries.id_proof_filename IS 'Nom fichier sécurisé (dossier beneficiary_ids), upload à la création du transfert';
