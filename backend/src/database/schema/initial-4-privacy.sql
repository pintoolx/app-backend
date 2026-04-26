-- Strategy Platform Migration (Phase 2 - Privacy adapters)
-- Reference: backend/docs/STRATEGY_PLATFORM_DEV_SPEC.md, Week 4 plan
--
-- Adds tracking columns for MagicBlock ER session metadata and Umbra
-- per-deployment EncryptedUserAccount registration. Columns are nullable so
-- legacy deployments stay valid; only deployments that opt into er or umbra
-- treasury modes populate them.

ALTER TABLE public.strategy_deployments
  ADD COLUMN IF NOT EXISTS er_delegate_signature text,
  ADD COLUMN IF NOT EXISTS er_undelegate_signature text,
  ADD COLUMN IF NOT EXISTS er_router_url text,
  ADD COLUMN IF NOT EXISTS er_committed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS umbra_x25519_pubkey text,
  ADD COLUMN IF NOT EXISTS umbra_signer_pubkey text,
  ADD COLUMN IF NOT EXISTS umbra_registration_status text
    CHECK (umbra_registration_status IS NULL
      OR umbra_registration_status IN ('pending', 'confirmed', 'failed')),
  ADD COLUMN IF NOT EXISTS umbra_register_queue_signature text,
  ADD COLUMN IF NOT EXISTS umbra_register_callback_signature text,
  ADD COLUMN IF NOT EXISTS umbra_master_seed_ref text;

COMMENT ON COLUMN public.strategy_deployments.er_delegate_signature
  IS 'MagicBlock router delegate tx signature recorded when execution_mode=er';
COMMENT ON COLUMN public.strategy_deployments.er_undelegate_signature
  IS 'MagicBlock commit-and-undelegate tx signature on stop transition';
COMMENT ON COLUMN public.strategy_deployments.umbra_signer_pubkey
  IS 'Public key of the deterministic per-deployment signer used for Umbra';
COMMENT ON COLUMN public.strategy_deployments.umbra_master_seed_ref
  IS 'Reference (e.g. HKDF salt) for deriving the deployment Umbra signer; never the secret itself';
