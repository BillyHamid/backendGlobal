-- 008: Rapports financiers avec justificatifs (Bernadette → admin SANA)

CREATE TABLE IF NOT EXISTS financial_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    total_amount DECIMAL(15, 2) NOT NULL CHECK (total_amount > 0),
    comment TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    submitted_at TIMESTAMP WITH TIME ZONE,
    validated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    validated_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    currency VARCHAR(10) NOT NULL DEFAULT 'XOF'
);

CREATE INDEX IF NOT EXISTS idx_financial_reports_created_by ON financial_reports(created_by);
CREATE INDEX IF NOT EXISTS idx_financial_reports_status ON financial_reports(status);
CREATE INDEX IF NOT EXISTS idx_financial_reports_created_at ON financial_reports(created_at DESC);

CREATE TABLE IF NOT EXISTS financial_report_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_id UUID NOT NULL REFERENCES financial_reports(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    amount DECIMAL(15, 2) NOT NULL CHECK (amount > 0),
    proof_file VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_financial_report_items_report_id ON financial_report_items(report_id);

DROP TRIGGER IF EXISTS update_financial_reports_updated_at ON financial_reports;
CREATE TRIGGER update_financial_reports_updated_at
    BEFORE UPDATE ON financial_reports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
