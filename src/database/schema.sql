-- ============================================
-- GLOBAL EXCHANGE - Database Schema (Production-Ready)
-- Consolidé : schéma de base + migrations 002→010
-- UUID : gen_random_uuid() natif PostgreSQL 13+
-- Idempotent : peut être relancé sans erreur
-- ============================================

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'supervisor', 'sender_agent', 'payer_agent')),
    country VARCHAR(100),
    agent_code VARCHAR(20) UNIQUE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_agent_code ON users(agent_code);

-- ============================================
-- SENDERS TABLE (Expéditeurs)
-- ============================================
CREATE TABLE IF NOT EXISTS senders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    email VARCHAR(255),
    country VARCHAR(10) NOT NULL,
    address TEXT,
    id_type VARCHAR(50),
    id_number VARCHAR(100),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_senders_phone ON senders(phone);
CREATE INDEX IF NOT EXISTS idx_senders_name ON senders(last_name, first_name);

-- ============================================
-- BENEFICIARIES TABLE (Bénéficiaires)
-- ============================================
CREATE TABLE IF NOT EXISTS beneficiaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    country VARCHAR(10) NOT NULL,
    city VARCHAR(100),
    address TEXT,
    id_type VARCHAR(50),
    id_number VARCHAR(100),
    id_proof_filename VARCHAR(500),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_beneficiaries_phone ON beneficiaries(phone);
CREATE INDEX IF NOT EXISTS idx_beneficiaries_name ON beneficiaries(last_name, first_name);

-- ============================================
-- TRANSFERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference VARCHAR(20) UNIQUE NOT NULL,

    -- Sender info
    sender_id UUID REFERENCES senders(id),
    sender_country VARCHAR(10) NOT NULL,
    send_method VARCHAR(50) NOT NULL,

    -- Beneficiary info
    beneficiary_id UUID REFERENCES beneficiaries(id),
    beneficiary_country VARCHAR(10) NOT NULL,
    beneficiary_city VARCHAR(100),

    -- Financial info
    amount_sent DECIMAL(15, 2) NOT NULL,
    currency_sent VARCHAR(10) NOT NULL,
    exchange_rate DECIMAL(15, 4) NOT NULL,
    rate_reel DECIMAL(15, 4),
    fees DECIMAL(15, 2) NOT NULL DEFAULT 0,
    amount_received DECIMAL(15, 2) NOT NULL,
    currency_received VARCHAR(10) NOT NULL DEFAULT 'XOF',

    -- Status and tracking
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'paid', 'confirmed', 'cancelled')),

    -- Agents
    created_by UUID REFERENCES users(id) NOT NULL,
    paid_by UUID REFERENCES users(id),

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE,

    -- Confirmation / proof
    proof_file_path VARCHAR(500),
    confirmation_comment TEXT,
    confirmed_at TIMESTAMP WITH TIME ZONE,
    confirmation_ip VARCHAR(50),

    -- Notes
    notes TEXT,
    cancellation_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_transfers_reference ON transfers(reference);
CREATE INDEX IF NOT EXISTS idx_transfers_status ON transfers(status);
CREATE INDEX IF NOT EXISTS idx_transfers_created_by ON transfers(created_by);
CREATE INDEX IF NOT EXISTS idx_transfers_paid_by ON transfers(paid_by);
CREATE INDEX IF NOT EXISTS idx_transfers_created_at ON transfers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_confirmed_at ON transfers(confirmed_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_proof_file ON transfers(proof_file_path) WHERE proof_file_path IS NOT NULL;

-- ============================================
-- EXCHANGE RATES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS exchange_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_currency VARCHAR(10) NOT NULL,
    to_currency VARCHAR(10) NOT NULL,
    rate DECIMAL(15, 4) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(from_currency, to_currency)
);

-- ============================================
-- AUDIT LOG TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(50),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- ============================================
-- PUSH SUBSCRIPTIONS TABLE (Notifications)
-- ============================================
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT UNIQUE NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);

-- ============================================
-- ACCOUNTS TABLE (Caisses USA / BURKINA)
-- ============================================
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL UNIQUE CHECK (name IN ('USA', 'BURKINA')),
    currency VARCHAR(10) NOT NULL CHECK (currency IN ('USD', 'XOF')),
    current_balance DECIMAL(15, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_accounts_name ON accounts(name);
CREATE INDEX IF NOT EXISTS idx_accounts_currency ON accounts(currency);

-- ============================================
-- LEDGER ENTRIES TABLE (Journal comptable)
-- ============================================
CREATE TABLE IF NOT EXISTS ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    transaction_id UUID REFERENCES transfers(id) ON DELETE SET NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('DEBIT', 'CREDIT')),
    amount DECIMAL(15, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    description TEXT NOT NULL,
    proof_file_path VARCHAR(500),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger_entries(account_id);
CREATE INDEX IF NOT EXISTS idx_ledger_transaction ON ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_created_at ON ledger_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_type ON ledger_entries(type);

-- ============================================
-- SPECIAL EXPENSES TABLE (Dépenses simples)
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

-- ============================================
-- PERSONAL WALLETS TABLE (Portefeuilles prêts)
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

-- ============================================
-- LOANS TABLE (Prêts)
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

-- ============================================
-- FINANCIAL REPORTS TABLE (Rapports financiers)
-- ============================================
CREATE TABLE IF NOT EXISTS financial_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    total_amount DECIMAL(15, 2) NOT NULL CHECK (total_amount > 0),
    comment TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED')),
    currency VARCHAR(10) NOT NULL DEFAULT 'XOF',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    submitted_at TIMESTAMP WITH TIME ZONE,
    validated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    validated_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_financial_reports_created_by ON financial_reports(created_by);
CREATE INDEX IF NOT EXISTS idx_financial_reports_status ON financial_reports(status);
CREATE INDEX IF NOT EXISTS idx_financial_reports_created_at ON financial_reports(created_at DESC);

-- ============================================
-- FINANCIAL REPORT ITEMS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS financial_report_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES financial_reports(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    amount DECIMAL(15, 2) NOT NULL CHECK (amount > 0),
    proof_file VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_financial_report_items_report_id ON financial_report_items(report_id);

-- ============================================
-- FUNCTION: Update updated_at timestamp
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- ============================================
-- FUNCTION: Auto-update account balance on ledger insert
-- ============================================
CREATE OR REPLACE FUNCTION update_account_balance()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.type = 'CREDIT' THEN
            UPDATE accounts
            SET current_balance = current_balance + NEW.amount,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = NEW.account_id;
        ELSIF NEW.type = 'DEBIT' THEN
            UPDATE accounts
            SET current_balance = current_balance - NEW.amount,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = NEW.account_id;
        END IF;
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGERS: updated_at auto-update
-- ============================================
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_senders_updated_at ON senders;
CREATE TRIGGER update_senders_updated_at BEFORE UPDATE ON senders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_beneficiaries_updated_at ON beneficiaries;
CREATE TRIGGER update_beneficiaries_updated_at BEFORE UPDATE ON beneficiaries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_transfers_updated_at ON transfers;
CREATE TRIGGER update_transfers_updated_at BEFORE UPDATE ON transfers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_exchange_rates_updated_at ON exchange_rates;
CREATE TRIGGER update_exchange_rates_updated_at BEFORE UPDATE ON exchange_rates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_push_subscriptions_updated_at ON push_subscriptions;
CREATE TRIGGER update_push_subscriptions_updated_at BEFORE UPDATE ON push_subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_accounts_updated_at ON accounts;
CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_special_expenses_updated_at ON special_expenses;
CREATE TRIGGER update_special_expenses_updated_at BEFORE UPDATE ON special_expenses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_personal_wallets_updated_at ON personal_wallets;
CREATE TRIGGER update_personal_wallets_updated_at BEFORE UPDATE ON personal_wallets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_loans_updated_at ON loans;
CREATE TRIGGER update_loans_updated_at BEFORE UPDATE ON loans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_financial_reports_updated_at ON financial_reports;
CREATE TRIGGER update_financial_reports_updated_at BEFORE UPDATE ON financial_reports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- TRIGGER: Auto-update account balance on ledger insert
-- ============================================
DROP TRIGGER IF EXISTS update_account_balance_trigger ON ledger_entries;
CREATE TRIGGER update_account_balance_trigger
    AFTER INSERT ON ledger_entries
    FOR EACH ROW
    EXECUTE FUNCTION update_account_balance();

-- ============================================
-- SEED: Default cash accounts
-- ============================================
INSERT INTO accounts (name, currency, current_balance)
VALUES
    ('USA', 'USD', 0),
    ('BURKINA', 'XOF', 0)
ON CONFLICT (name) DO NOTHING;
