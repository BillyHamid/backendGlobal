-- Rapports financiers libellés en XOF (montants en francs CFA)

ALTER TABLE financial_reports
ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NOT NULL DEFAULT 'XOF';

COMMENT ON COLUMN financial_reports.currency IS 'Devise du rapport (XOF pour Burkina)';
