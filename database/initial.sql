-- ==========================================
-- Solana Workflow Platform - Simplified Schema
-- 只有 Tables + RLS，業務邏輯在應用層處理
-- ==========================================

-- ==========================================
-- 1. Users Table
-- ==========================================
CREATE TABLE users (
    wallet_address TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMPTZ
);

-- ==========================================
-- 2. Telegram Mappings Table
-- ==========================================
CREATE TABLE telegram_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address TEXT NOT NULL REFERENCES users(wallet_address) ON DELETE CASCADE,
    chat_id TEXT NOT NULL UNIQUE,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    notifications_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_interaction_at TIMESTAMPTZ,
    
    UNIQUE(wallet_address, chat_id)
);

CREATE INDEX idx_telegram_mappings_wallet ON telegram_mappings(wallet_address);
CREATE INDEX idx_telegram_mappings_chat ON telegram_mappings(chat_id);

-- ==========================================
-- 3. Workflows Table
-- ==========================================
CREATE TABLE workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_wallet_address TEXT NOT NULL REFERENCES users(wallet_address) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    definition JSONB NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(owner_wallet_address, name)
);

CREATE INDEX idx_workflows_owner ON workflows(owner_wallet_address);
CREATE INDEX idx_workflows_active ON workflows(is_active);

-- ==========================================
-- 4. Accounts Table
-- ==========================================
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_wallet_address TEXT NOT NULL REFERENCES users(wallet_address) ON DELETE CASCADE,
    name TEXT NOT NULL,
    account_address TEXT NOT NULL UNIQUE,
    encrypted_private_key TEXT NOT NULL,
    encryption_method TEXT NOT NULL DEFAULT 'aes256',
    current_workflow_id UUID REFERENCES workflows(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(owner_wallet_address, name)
);

CREATE INDEX idx_accounts_owner ON accounts(owner_wallet_address);
CREATE INDEX idx_accounts_address ON accounts(account_address);
CREATE INDEX idx_accounts_workflow ON accounts(current_workflow_id);

-- ==========================================
-- 5. Workflow Executions Table
-- ==========================================
CREATE TABLE workflow_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    owner_wallet_address TEXT NOT NULL REFERENCES users(wallet_address) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    trigger_type TEXT CHECK (trigger_type IN ('manual', 'scheduled', 'price_trigger', 'webhook', 'telegram_command')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    execution_data JSONB,
    error_message TEXT,
    error_stack TEXT,
    telegram_notified BOOLEAN DEFAULT false,
    telegram_notification_sent_at TIMESTAMPTZ,
    telegram_message_id TEXT,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_workflow_executions_workflow ON workflow_executions(workflow_id);
CREATE INDEX idx_workflow_executions_account ON workflow_executions(account_id);
CREATE INDEX idx_workflow_executions_owner ON workflow_executions(owner_wallet_address);
CREATE INDEX idx_workflow_executions_status ON workflow_executions(status);
CREATE INDEX idx_workflow_executions_started ON workflow_executions(started_at DESC);
CREATE INDEX idx_workflow_executions_telegram_notify ON workflow_executions(telegram_notified) 
    WHERE telegram_notified = false AND status IN ('completed', 'failed');

-- ==========================================
-- 6. Node Executions Table
-- ==========================================
CREATE TABLE node_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_execution_id UUID NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    node_name TEXT NOT NULL,
    node_type TEXT NOT NULL,
    execution_order INTEGER,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    input_data JSONB,
    output_data JSONB,
    parameters JSONB,
    error_message TEXT,
    error_stack TEXT,
    transaction_signature TEXT,
    transaction_status TEXT,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_node_executions_workflow_execution ON node_executions(workflow_execution_id);
CREATE INDEX idx_node_executions_type ON node_executions(node_type);

-- ==========================================
-- 7. Transaction History Table
-- ==========================================
CREATE TABLE transaction_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    owner_wallet_address TEXT NOT NULL REFERENCES users(wallet_address) ON DELETE CASCADE,
    workflow_execution_id UUID REFERENCES workflow_executions(id) ON DELETE SET NULL,
    node_execution_id UUID REFERENCES node_executions(id) ON DELETE SET NULL,
    signature TEXT NOT NULL UNIQUE,
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('swap', 'deposit', 'withdraw', 'transfer', 'stake', 'unstake')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'failed')),
    input_token TEXT,
    output_token TEXT,
    input_amount DECIMAL(30, 10),
    output_amount DECIMAL(30, 10),
    vault_address TEXT,
    vault_name TEXT,
    fee_sol DECIMAL(20, 9),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_transaction_history_account ON transaction_history(account_id);
CREATE INDEX idx_transaction_history_owner ON transaction_history(owner_wallet_address);
CREATE INDEX idx_transaction_history_signature ON transaction_history(signature);
CREATE INDEX idx_transaction_history_created ON transaction_history(created_at DESC);

-- ==========================================
-- 8. System Configuration Table
-- ==========================================
CREATE TABLE system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    is_encrypted BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_config (key, value, description, is_encrypted)
VALUES ('telegram_bot_token', 'YOUR_BOT_TOKEN_HERE', 'Telegram Bot Token', true);

-- ==========================================
-- Auto-update updated_at Trigger
-- ==========================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_telegram_mappings_updated_at BEFORE UPDATE ON telegram_mappings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_workflows_updated_at BEFORE UPDATE ON workflows
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- Row Level Security (RLS)
-- ==========================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE node_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_history ENABLE ROW LEVEL SECURITY;

-- Users policies
CREATE POLICY "Users can view own data" ON users
    FOR SELECT USING (wallet_address = current_setting('app.current_wallet', true)::text);

CREATE POLICY "Users can update own data" ON users
    FOR UPDATE USING (wallet_address = current_setting('app.current_wallet', true)::text);

CREATE POLICY "Users can insert own data" ON users
    FOR INSERT WITH CHECK (wallet_address = current_setting('app.current_wallet', true)::text);

-- Telegram mappings policies
CREATE POLICY "Users can manage own telegram mappings" ON telegram_mappings
    FOR ALL USING (wallet_address = current_setting('app.current_wallet', true)::text);

-- Accounts policies
CREATE POLICY "Users can manage own accounts" ON accounts
    FOR ALL USING (owner_wallet_address = current_setting('app.current_wallet', true)::text);

-- Workflows policies
CREATE POLICY "Users can manage own workflows" ON workflows
    FOR ALL USING (owner_wallet_address = current_setting('app.current_wallet', true)::text);

-- Workflow executions policies
CREATE POLICY "Users can view own executions" ON workflow_executions
    FOR SELECT USING (owner_wallet_address = current_setting('app.current_wallet', true)::text);

CREATE POLICY "Users can insert own executions" ON workflow_executions
    FOR INSERT WITH CHECK (owner_wallet_address = current_setting('app.current_wallet', true)::text);

CREATE POLICY "Users can update own executions" ON workflow_executions
    FOR UPDATE USING (owner_wallet_address = current_setting('app.current_wallet', true)::text);

-- Node executions policies (通過 workflow_execution 關聯)
CREATE POLICY "Users can view own node executions" ON node_executions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM workflow_executions we
            WHERE we.id = node_executions.workflow_execution_id
            AND we.owner_wallet_address = current_setting('app.current_wallet', true)::text
        )
    );

CREATE POLICY "Users can manage own node executions" ON node_executions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM workflow_executions we
            WHERE we.id = node_executions.workflow_execution_id
            AND we.owner_wallet_address = current_setting('app.current_wallet', true)::text
        )
    );

-- Transaction history policies
CREATE POLICY "Users can view own transactions" ON transaction_history
    FOR SELECT USING (owner_wallet_address = current_setting('app.current_wallet', true)::text);

CREATE POLICY "Users can insert own transactions" ON transaction_history
    FOR INSERT WITH CHECK (owner_wallet_address = current_setting('app.current_wallet', true)::text);

-- ==========================================
-- Useful Views (可選)
-- ==========================================

CREATE VIEW accounts_with_workflows AS
SELECT 
    a.id as account_id,
    a.owner_wallet_address,
    a.name as account_name,
    a.account_address,
    a.is_active,
    w.id as workflow_id,
    w.name as workflow_name,
    w.is_active as workflow_is_active
FROM accounts a
LEFT JOIN workflows w ON a.current_workflow_id = w.id;