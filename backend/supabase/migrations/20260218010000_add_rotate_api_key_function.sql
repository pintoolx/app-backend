-- Atomic key rotation function (prevents race condition on concurrent register calls)
CREATE OR REPLACE FUNCTION public.rotate_api_key(
  p_wallet text,
  p_key_hash text,
  p_key_prefix text,
  p_name text DEFAULT 'Default'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_id uuid;
BEGIN
  -- Deactivate all existing active keys for this wallet
  UPDATE public.api_keys
    SET is_active = false, updated_at = now()
    WHERE wallet_address = p_wallet AND is_active = true;

  -- Insert the new active key
  INSERT INTO public.api_keys (key_hash, key_prefix, wallet_address, name, is_active)
    VALUES (p_key_hash, p_key_prefix, p_wallet, p_name, true)
    RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
