-- Convertir l'ancien accès lié à un email en droit individuel administrable.
-- Le backfill ne se produit qu'à la création de la colonne : relancer cette
-- migration ne rétablit jamais un accès retiré ensuite par l'administrateur.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'has_special_access'
  ) THEN
    ALTER TABLE public.users ADD COLUMN has_special_access BOOLEAN NOT NULL DEFAULT false;
    UPDATE public.users SET has_special_access = true
    WHERE lower(email) = 'razack@globalexchange.com';
  END IF;
END $$;
