-- Atomic admin refresh-token rotation.
-- Locks the current token row and inserts the replacement token within the
-- same transaction so concurrent refresh attempts cannot both succeed.
CREATE OR REPLACE FUNCTION public.rotate_admin_refresh_token(
  p_old_token_hash text,
  p_new_token_hash text,
  p_expires_at timestamp with time zone,
  p_user_agent text DEFAULT NULL,
  p_ip_address inet DEFAULT NULL
)
RETURNS TABLE (
  outcome text,
  admin_user_id uuid,
  previous_token_id uuid,
  replacement_token_id uuid,
  previous_status text,
  previous_expires_at timestamp with time zone
)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.admin_refresh_tokens%ROWTYPE;
  v_new_token_id uuid;
BEGIN
  SELECT *
  INTO v_existing
  FROM public.admin_refresh_tokens
  WHERE token_hash = p_old_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      'missing'::text,
      NULL::uuid,
      NULL::uuid,
      NULL::uuid,
      NULL::text,
      NULL::timestamptz;
    RETURN;
  END IF;

  IF v_existing.status <> 'active' THEN
    RETURN QUERY
    SELECT
      'already_used'::text,
      v_existing.admin_user_id,
      v_existing.id,
      v_existing.replaced_by,
      v_existing.status,
      v_existing.expires_at;
    RETURN;
  END IF;

  IF v_existing.expires_at <= now() THEN
    RETURN QUERY
    SELECT
      'expired'::text,
      v_existing.admin_user_id,
      v_existing.id,
      NULL::uuid,
      v_existing.status,
      v_existing.expires_at;
    RETURN;
  END IF;

  INSERT INTO public.admin_refresh_tokens (
    admin_user_id,
    token_hash,
    status,
    expires_at,
    user_agent,
    ip_address
  )
  VALUES (
    v_existing.admin_user_id,
    p_new_token_hash,
    'active',
    p_expires_at,
    p_user_agent,
    p_ip_address
  )
  RETURNING id INTO v_new_token_id;

  UPDATE public.admin_refresh_tokens
  SET status = 'replaced',
      replaced_by = v_new_token_id
  WHERE id = v_existing.id;

  RETURN QUERY
  SELECT
    'rotated'::text,
    v_existing.admin_user_id,
    v_existing.id,
    v_new_token_id,
    v_existing.status,
    v_existing.expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_admin_refresh_token(text, text, timestamp with time zone, text, inet)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_admin_refresh_token(text, text, timestamp with time zone, text, inet)
  TO service_role, postgres;
