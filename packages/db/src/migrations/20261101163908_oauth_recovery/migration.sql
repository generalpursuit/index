-- Recovery also disconnects every app: deleting the account's approvals deletes their pending
-- codes and tokens (see oauth_code_approval), in the transaction that replaces the password
-- and holds the account's user row. Signing out keeps apps connected.
CREATE OR REPLACE FUNCTION index_auth_consume(p_key text, p_hash text, p_session text, p_password text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE c auth_challenge%ROWTYPE; uid text; u "user"%ROWTYPE;
BEGIN
  SELECT user_id INTO uid FROM auth_challenge WHERE key=p_key;
  IF uid IS NOT NULL THEN SELECT * INTO u FROM "user" WHERE id=uid FOR UPDATE; END IF;
  SELECT * INTO c FROM auth_challenge WHERE key=p_key FOR UPDATE;
  IF NOT FOUND OR c.user_id IS DISTINCT FROM uid OR c.consumed OR c.expires_at<=now() OR c.attempts>=5 OR c.delivery='failed' THEN RETURN 'invalid'; END IF;
  -- A different session must neither consume nor exhaust the original signup attempt.
  IF c.purpose<>'reset' AND (c.session_id IS DISTINCT FROM p_session OR NOT EXISTS(
    SELECT 1 FROM "session" WHERE id=p_session AND user_id=c.user_id AND expires_at>now())) THEN RETURN 'invalid'; END IF;
  UPDATE auth_challenge SET attempts=attempts+1 WHERE key=p_key;
  IF c.code_hash<>p_hash OR c.user_id IS NULL OR u.email IS DISTINCT FROM c.original_email THEN RETURN 'invalid'; END IF;
  IF c.purpose='reset' THEN
    IF p_password IS NULL THEN RETURN 'invalid'; END IF;
    UPDATE account SET password=p_password, updated_at=now() WHERE user_id=c.user_id AND provider_id='credential';
    IF NOT FOUND THEN RETURN 'invalid'; END IF;
    -- A reset proves email ownership but never creates a login session.
    UPDATE "user" SET email_verified=true,updated_at=now() WHERE id=c.user_id;
    DELETE FROM "session" WHERE user_id=c.user_id;
    DELETE FROM oauth_consent WHERE user_id=c.user_id;
  ELSE
    IF (c.purpose='verify' AND u.email_verified) OR (c.purpose='change-email' AND NOT u.email_verified) THEN RETURN 'invalid'; END IF;
    BEGIN
      UPDATE "user" SET email=c.email,email_verified=true,updated_at=now() WHERE id=c.user_id;
    EXCEPTION WHEN unique_violation THEN
      UPDATE auth_challenge SET consumed=true WHERE key=p_key;
      RETURN 'unavailable';
    END;
    DELETE FROM "session" WHERE user_id=c.user_id AND id<>p_session;
  END IF;
  -- Invalidate pending corrections, resets and changes together with the credential write.
  UPDATE auth_challenge SET consumed=true WHERE user_id=c.user_id;
  RETURN 'ok';
END $$;--> statement-breakpoint
-- An approval racing recovery waits for the account's user row, which recovery holds until
-- the account's sessions are gone, and is then refused: left behind, it would let the app's
-- next authorization skip consent.
CREATE OR REPLACE FUNCTION index_oauth_consent_merge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "user" WHERE id=NEW.user_id FOR NO KEY UPDATE;
  IF NOT EXISTS(SELECT 1 FROM "session" WHERE user_id=NEW.user_id AND expires_at>now()) THEN
    RAISE EXCEPTION 'approval without a session' USING ERRCODE='insufficient_privilege';
  END IF;
  UPDATE oauth_consent SET scopes=NEW.scopes, resources=NEW.resources,
    requested_user_info_claims=NEW.requested_user_info_claims, reference_id=NEW.reference_id,
    updated_at=NEW.updated_at
  WHERE user_id=NEW.user_id AND client_id=NEW.client_id;
  IF FOUND THEN RETURN NULL; END IF;
  RETURN NEW;
END $$;
