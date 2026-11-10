-- 001_initial_schema.down.sql
-- Reversible rollback migration

DROP INDEX IF EXISTS idx_outbox_pending;
DROP TABLE IF EXISTS outbox_messages CASCADE;

DROP TABLE IF EXISTS inbox_messages CASCADE;

DROP INDEX IF EXISTS wager_transactions_single_reversal_key;
DROP INDEX IF EXISTS idx_wager_tx_pending_ref;
DROP INDEX IF EXISTS idx_wager_tx_provider_external;
DROP TABLE IF EXISTS wager_transactions CASCADE;

DROP TRIGGER IF EXISTS trg_prevent_ledger_modification ON wallet_ledger;
DROP FUNCTION IF EXISTS prevent_ledger_update_delete();
DROP TABLE IF EXISTS wallet_ledger CASCADE;

DROP TABLE IF EXISTS wallets CASCADE;

