-- 001_initial_schema.sql
-- PostgreSQL Schema with strict DDL invariants (Constraints & Triggers)

-- 1. Wallets
CREATE TABLE IF NOT EXISTS wallets (
    id VARCHAR(64) PRIMARY KEY,
    player_id VARCHAR(64) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    balance NUMERIC(18, 2) NOT NULL,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT check_wallet_balance_positive CHECK (balance >= 0),
    CONSTRAINT unique_player_currency UNIQUE (player_id, currency)
);

-- 2. Wallet Ledger
CREATE TABLE IF NOT EXISTS wallet_ledger (
    id VARCHAR(64) PRIMARY KEY,
    wallet_id VARCHAR(64) NOT NULL REFERENCES wallets(id),
    transaction_id VARCHAR(64) NOT NULL,
    direction VARCHAR(10) NOT NULL,
    amount NUMERIC(18, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    balance_before NUMERIC(18, 2) NOT NULL,
    balance_after NUMERIC(18, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger for Ledger Immutability
CREATE OR REPLACE FUNCTION prevent_ledger_update_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Ledger entries are immutable and cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_ledger_modification ON wallet_ledger;
CREATE TRIGGER trg_prevent_ledger_modification
BEFORE UPDATE OR DELETE ON wallet_ledger
FOR EACH ROW
EXECUTE FUNCTION prevent_ledger_update_delete();

-- 3. Wager Transactions
CREATE TABLE IF NOT EXISTS wager_transactions (
    id VARCHAR(64) PRIMARY KEY,
    provider_id VARCHAR(64) NOT NULL,
    external_transaction_id VARCHAR(128) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    payload_hash VARCHAR(64) NOT NULL,
    wallet_id VARCHAR(64) NOT NULL REFERENCES wallets(id),
    player_id VARCHAR(64) NOT NULL,
    round_id VARCHAR(64) NOT NULL,
    game_id VARCHAR(64) NOT NULL,
    kind VARCHAR(20) NOT NULL,
    amount NUMERIC(18, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    reference_external_transaction_id VARCHAR(128),
    status VARCHAR(20) NOT NULL,
    rejection_reason VARCHAR(255),
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_idempotency_key UNIQUE (idempotency_key),
    CONSTRAINT unique_provider_external_tx UNIQUE (provider_id, external_transaction_id)
);

-- Index for resolving references by providerId + referenceExternalTransactionId
CREATE INDEX IF NOT EXISTS idx_wager_tx_provider_external
ON wager_transactions (provider_id, external_transaction_id);

CREATE INDEX IF NOT EXISTS idx_wager_tx_pending_ref
ON wager_transactions (status) WHERE status = 'PENDING_REFERENCE';

-- 4. Transactional Inbox
CREATE TABLE IF NOT EXISTS inbox_messages (
    id VARCHAR(64) PRIMARY KEY,
    message_id VARCHAR(128) NOT NULL,
    consumer_name VARCHAR(64) NOT NULL,
    payload_hash VARCHAR(64) NOT NULL,
    processed_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_consumer_message UNIQUE (consumer_name, message_id)
);

-- 5. Transactional Outbox
CREATE TABLE IF NOT EXISTS outbox_messages (
    id VARCHAR(64) PRIMARY KEY,
    aggregate_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    next_attempt_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending
ON outbox_messages (published_at, next_attempt_at);

