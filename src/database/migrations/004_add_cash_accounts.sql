-- Migration: Add cash accounts and ledger system
-- For financial tracking between USA and Burkina Faso

-- ============================================
-- ACCOUNTS TABLE (Caisses)
-- ============================================
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) NOT NULL UNIQUE CHECK (name IN ('USA', 'BURKINA')),
    currency VARCHAR(10) NOT NULL CHECK (currency IN ('USD', 'XOF')),
    current_balance DECIMAL(15, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_accounts_name ON accounts(name);
CREATE INDEX idx_accounts_currency ON accounts(currency);

-- ============================================
-- LEDGER ENTRIES TABLE (Journal comptable)
-- ============================================
CREATE TABLE IF NOT EXISTS ledger_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    transaction_id UUID REFERENCES transfers(id) ON DELETE SET NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('DEBIT', 'CREDIT')),
    amount DECIMAL(15, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    description TEXT NOT NULL,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ledger_account ON ledger_entries(account_id);
CREATE INDEX idx_ledger_transaction ON ledger_entries(transaction_id);
CREATE INDEX idx_ledger_created_at ON ledger_entries(created_at DESC);
CREATE INDEX idx_ledger_type ON ledger_entries(type);

-- Trigger to update account balance
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

CREATE TRIGGER update_account_balance_trigger
    AFTER INSERT ON ledger_entries
    FOR EACH ROW
    EXECUTE FUNCTION update_account_balance();

-- Trigger to update accounts updated_at
CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Initialize default accounts (USA and BURKINA)
INSERT INTO accounts (name, currency, current_balance)
VALUES 
    ('USA', 'USD', 0),
    ('BURKINA', 'XOF', 0)
ON CONFLICT (name) DO NOTHING;
