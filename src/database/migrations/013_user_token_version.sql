-- Chaque changement de mot de passe révoque les sessions précédentes.
-- Les comptes et tokens existants démarrent à 0 ; relancer ne remet pas à zéro.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
