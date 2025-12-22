-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_wallet_address text NOT NULL,
  name text NOT NULL,
  account_address text NOT NULL UNIQUE,
  encrypted_private_key text NOT NULL,
  encryption_method text NOT NULL DEFAULT 'aes256'::text,
  current_workflow_id uuid,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT accounts_pkey PRIMARY KEY (id),
  CONSTRAINT accounts_owner_wallet_address_fkey FOREIGN KEY (owner_wallet_address) REFERENCES public.users(wallet_address),
  CONSTRAINT accounts_current_workflow_id_fkey FOREIGN KEY (current_workflow_id) REFERENCES public.workflows(id)
);
CREATE TABLE public.node_executions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workflow_execution_id uuid NOT NULL,
  node_id text NOT NULL,
  node_name text NOT NULL,
  node_type text NOT NULL,
  execution_order integer,
  status text NOT NULL CHECK (status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text, 'skipped'::text])),
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  duration_ms integer,
  input_data jsonb,
  output_data jsonb,
  parameters jsonb,
  error_message text,
  error_stack text,
  transaction_signature text,
  transaction_status text,
  metadata jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT node_executions_pkey PRIMARY KEY (id),
  CONSTRAINT node_executions_workflow_execution_id_fkey FOREIGN KEY (workflow_execution_id) REFERENCES public.workflow_executions(id)
);
CREATE TABLE public.system_config (
  key text NOT NULL,
  value text NOT NULL,
  description text,
  is_encrypted boolean DEFAULT false,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT system_config_pkey PRIMARY KEY (key)
);
CREATE TABLE public.telegram_mappings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  wallet_address text NOT NULL,
  chat_id text NOT NULL UNIQUE,
  username text,
  first_name text,
  last_name text,
  notifications_enabled boolean DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  last_interaction_at timestamp with time zone,
  CONSTRAINT telegram_mappings_pkey PRIMARY KEY (id),
  CONSTRAINT telegram_mappings_wallet_address_fkey FOREIGN KEY (wallet_address) REFERENCES public.users(wallet_address)
);
CREATE TABLE public.transaction_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  owner_wallet_address text NOT NULL,
  workflow_execution_id uuid,
  node_execution_id uuid,
  signature text NOT NULL UNIQUE,
  transaction_type text NOT NULL CHECK (transaction_type = ANY (ARRAY['swap'::text, 'deposit'::text, 'withdraw'::text, 'transfer'::text, 'stake'::text, 'unstake'::text])),
  status text NOT NULL CHECK (status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'failed'::text])),
  input_token text,
  output_token text,
  input_amount numeric,
  output_amount numeric,
  vault_address text,
  vault_name text,
  fee_sol numeric,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  confirmed_at timestamp with time zone,
  metadata jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT transaction_history_pkey PRIMARY KEY (id),
  CONSTRAINT transaction_history_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id),
  CONSTRAINT transaction_history_owner_wallet_address_fkey FOREIGN KEY (owner_wallet_address) REFERENCES public.users(wallet_address),
  CONSTRAINT transaction_history_workflow_execution_id_fkey FOREIGN KEY (workflow_execution_id) REFERENCES public.workflow_executions(id),
  CONSTRAINT transaction_history_node_execution_id_fkey FOREIGN KEY (node_execution_id) REFERENCES public.node_executions(id)
);
CREATE TABLE public.users (
  wallet_address text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  last_active_at timestamp with time zone,
  catpurr boolean NOT NULL DEFAULT false CHECK (catpurr = ANY (ARRAY[true, false])),
  email text UNIQUE,
  drift_hist jsonb,
  transfer_tx text,
  CONSTRAINT users_pkey PRIMARY KEY (wallet_address)
);
CREATE TABLE public.workflow_executions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL,
  account_id uuid NOT NULL,
  owner_wallet_address text NOT NULL,
  status text NOT NULL CHECK (status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])),
  trigger_type text CHECK (trigger_type = ANY (ARRAY['manual'::text, 'scheduled'::text, 'price_trigger'::text, 'webhook'::text, 'telegram_command'::text])),
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  duration_ms integer,
  execution_data jsonb,
  error_message text,
  error_stack text,
  telegram_notified boolean DEFAULT false,
  telegram_notification_sent_at timestamp with time zone,
  telegram_message_id text,
  metadata jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT workflow_executions_pkey PRIMARY KEY (id),
  CONSTRAINT workflow_executions_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id),
  CONSTRAINT workflow_executions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id),
  CONSTRAINT workflow_executions_owner_wallet_address_fkey FOREIGN KEY (owner_wallet_address) REFERENCES public.users(wallet_address)
);
CREATE TABLE public.workflows (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_wallet_address text NOT NULL,
  name text NOT NULL,
  description text,
  definition jsonb NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT workflows_pkey PRIMARY KEY (id),
  CONSTRAINT workflows_owner_wallet_address_fkey FOREIGN KEY (owner_wallet_address) REFERENCES public.users(wallet_address)
);