CREATE TABLE "auth_challenge" (
	"key" text PRIMARY KEY,
	"user_id" text,
	"session_id" text,
	"purpose" text NOT NULL,
	"email" text NOT NULL,
	"original_email" text NOT NULL,
	"nonce" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed" boolean DEFAULT false NOT NULL,
	"delivery" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_throttle" (
	"key" text PRIMARY KEY,
	"count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "auth_challenge_expiry_idx" ON "auth_challenge" ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_throttle_expiry_idx" ON "auth_throttle" ("expires_at");--> statement-breakpoint
ALTER TABLE "auth_challenge" ADD CONSTRAINT "auth_challenge_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
-- These functions keep locking, guess accounting, credential changes and revocation in
-- one transaction on Neon HTTP as well as PostgreSQL. Never raise on a wrong code:
-- raising would roll back its consumed guess. All account operations lock user first.
CREATE FUNCTION index_auth_limit(p_key text, p_max integer, p_seconds integer)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE accepted boolean;
BEGIN
  INSERT INTO auth_throttle(key, count, expires_at)
    VALUES(p_key, 1, now() + make_interval(secs => p_seconds))
  ON CONFLICT (key) DO UPDATE SET
    count = CASE WHEN auth_throttle.expires_at <= now() THEN 1 ELSE auth_throttle.count + 1 END,
    expires_at = CASE WHEN auth_throttle.expires_at <= now() THEN EXCLUDED.expires_at ELSE auth_throttle.expires_at END
  WHERE auth_throttle.expires_at <= now() OR auth_throttle.count < p_max
  RETURNING true INTO accepted;
  RETURN coalesce(accepted, false);
END $$;
--> statement-breakpoint
CREATE FUNCTION index_auth_issue(p_key text, p_user text, p_session text, p_purpose text,
  p_email text, p_original text, p_nonce text, p_hash text, p_password text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE u "user"%ROWTYPE; issued boolean;
BEGIN
  IF p_user IS NOT NULL THEN
    SELECT * INTO u FROM "user" WHERE id = p_user FOR UPDATE;
    IF NOT FOUND OR u.email <> p_original THEN RETURN false; END IF;
    IF p_purpose <> 'reset' THEN
      IF NOT EXISTS(SELECT 1 FROM "session" WHERE id=p_session AND user_id=p_user AND expires_at>now()) THEN RETURN false; END IF;
      IF (p_purpose='verify' AND u.email_verified) OR (p_purpose='change-email' AND NOT u.email_verified) THEN RETURN false; END IF;
      IF p_password IS NOT NULL AND NOT EXISTS(SELECT 1 FROM account WHERE user_id=p_user AND provider_id='credential' AND password=p_password) THEN RETURN false; END IF;
    END IF;
  END IF;
  INSERT INTO auth_challenge(key,user_id,session_id,purpose,email,original_email,nonce,code_hash,expires_at)
    VALUES(p_key,p_user,p_session,p_purpose,p_email,p_original,p_nonce,p_hash,now()+interval '10 minutes')
  ON CONFLICT (key) DO UPDATE SET user_id=EXCLUDED.user_id,session_id=EXCLUDED.session_id,
    email=EXCLUDED.email,original_email=EXCLUDED.original_email,nonce=EXCLUDED.nonce,
    code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at,sent_at=now(),attempts=0,consumed=false,delivery='pending'
  WHERE auth_challenge.sent_at <= now()-interval '60 seconds'
  RETURNING true INTO issued;
  RETURN coalesce(issued,false);
END $$;
--> statement-breakpoint
CREATE FUNCTION index_auth_consume(p_key text, p_hash text, p_session text, p_password text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE c auth_challenge%ROWTYPE; uid text; u "user"%ROWTYPE;
BEGIN
  SELECT user_id INTO uid FROM auth_challenge WHERE key=p_key;
  IF uid IS NOT NULL THEN SELECT * INTO u FROM "user" WHERE id=uid FOR UPDATE; END IF;
  SELECT * INTO c FROM auth_challenge WHERE key=p_key FOR UPDATE;
  IF NOT FOUND OR c.consumed OR c.expires_at<=now() OR c.attempts>=5 OR c.delivery='failed' THEN RETURN 'invalid'; END IF;
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
END $$;
--> statement-breakpoint
CREATE FUNCTION index_auth_password(p_user text,p_session text,p_old text,p_new text)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "user" WHERE id=p_user AND email_verified FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM "session" WHERE id=p_session AND user_id=p_user AND expires_at>now()) THEN RETURN false; END IF;
  UPDATE account SET password=p_new,updated_at=now() WHERE user_id=p_user AND provider_id='credential' AND password=p_old;
  IF NOT FOUND THEN RETURN false; END IF;
  DELETE FROM "session" WHERE user_id=p_user AND id<>p_session;
  UPDATE auth_challenge SET consumed=true WHERE user_id=p_user;
  RETURN true;
END $$;
