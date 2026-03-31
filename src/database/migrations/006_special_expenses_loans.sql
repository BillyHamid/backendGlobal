-- Migration 006: Dépenses Spéciales & Prêts
-- Accès réservé : admin + Zongo Razack (sender_agent, email razack@globalexchange.com)

-- ============================================
-- TABLE : special_expenses (Dépenses simples)
-- Déduites de TFEES (frais cumulés USA→BF payés)
-- ============================================
CREATE TABLE IF NOT EXISTS special_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(20) NOT NULL DEFAULT 'simple_expense' CHECK (type = 'simple_expense'),
    amount DECIMAL(15, 2) NOT NULL CHECK (amount > 0),
    description TEXT NOT NULL,
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    receipt_image VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_special_expenses_created_by ON special_expenses(created_by);
CREATE INDEX IF NOT EXISTS idx_special_expenses_date ON special_expenses(expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_special_expenses_created_at ON special_expenses(created_at DESC);

CREATE TRIGGER update_special_expenses_updated_at
    BEFORE UPDATE ON special_expenses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- TABLE : personal_wallets (Caisses personnelles de prêt)
-- Une par utilisateur autorisé
-- ============================================
CREATE TABLE IF NOT EXISTS personal_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
    balance DECIMAL(15, 2) NOT NULL DEFAULT 0,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_personal_wallets_user_id ON personal_wallets(user_id);

CREATE TRIGGER update_personal_wallets_updated_at
    BEFORE UPDATE ON personal_wallets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- TABLE : loans (Prêts entre admin et Zongo Razack)
-- ============================================
CREATE TABLE IF NOT EXISTS loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lender_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    borrower_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount DECIMAL(15, 2) NOT NULL CHECK (amount > 0),
    reason TEXT NOT NULL,
    loan_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT loans_different_users CHECK (lender_id <> borrower_id)
);

CREATE INDEX IF NOT EXISTS idx_loans_lender ON loans(lender_id);
CREATE INDEX IF NOT EXISTS idx_loans_borrower ON loans(borrower_id);
CREATE INDEX IF NOT EXISTS idx_loans_date ON loans(loan_date DESC);
CREATE INDEX IF NOT EXISTS idx_loans_created_at ON loans(created_at DESC);

CREATE TRIGGER update_loans_updated_at
    BEFORE UPDATE ON loans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
