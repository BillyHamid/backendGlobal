-- Reset manuel (psql) : dépenses simples + prêts + soldes caisses perso
-- psql $DATABASE_URL -f src/database/reset_special_test.sql

BEGIN;

DELETE FROM special_expenses;
DELETE FROM loans;
UPDATE personal_wallets SET balance = 0, updated_at = CURRENT_TIMESTAMP;

COMMIT;
