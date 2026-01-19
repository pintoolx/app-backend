-- Migration: Remove legacy wallet fields from accounts table
-- Date: 2026-01-18
-- Description: Remove old self-managed wallet columns after Crossmint migration
--              This removes account_address, encrypted_private_key, and encryption_method

-- =====================================================
-- Step 1: Drop indexes on old columns (if any)
-- =====================================================

DROP INDEX IF EXISTS idx_accounts_account_address;

-- =====================================================
-- Step 2: Drop constraints
-- =====================================================

-- Remove UNIQUE constraint on account_address
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_account_address_key;

-- =====================================================
-- Step 3: Remove old columns
-- =====================================================

ALTER TABLE accounts 
  DROP COLUMN IF EXISTS account_address,
  DROP COLUMN IF EXISTS encrypted_private_key,
  DROP COLUMN IF EXISTS encryption_method;

-- =====================================================
-- Step 4: Make Crossmint columns required
-- =====================================================

-- Ensure crossmint columns are NOT NULL for new accounts
-- (Only run this if you're sure all existing accounts have been migrated)
-- ALTER TABLE accounts 
--   ALTER COLUMN crossmint_wallet_locator SET NOT NULL,
--   ALTER COLUMN crossmint_wallet_address SET NOT NULL;

-- =====================================================
-- Step 5: Add UNIQUE constraint on crossmint_wallet_address
-- =====================================================

ALTER TABLE accounts 
  ADD CONSTRAINT accounts_crossmint_wallet_address_key UNIQUE (crossmint_wallet_address);

-- =====================================================
-- Rollback script (if needed)
-- =====================================================

-- To rollback this migration, run:
-- ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_crossmint_wallet_address_key;
-- ALTER TABLE accounts 
--   ADD COLUMN account_address text,
--   ADD COLUMN encrypted_private_key text,
--   ADD COLUMN encryption_method text DEFAULT 'aes256';
-- ALTER TABLE accounts ADD CONSTRAINT accounts_account_address_key UNIQUE (account_address);
