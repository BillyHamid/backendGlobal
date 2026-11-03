CREATE TABLE IF NOT EXISTS role_permissions (
  role VARCHAR(50) PRIMARY KEY CHECK (role IN ('supervisor', 'sender_agent', 'payer_agent')),
  permissions JSONB NOT NULL CHECK (jsonb_typeof(permissions) = 'array'),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
-- L'absence de ligne conserve les droits par défaut ; les migrations ne les réinitialisent pas.
