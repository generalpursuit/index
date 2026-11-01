CREATE TABLE "oauth_access_token" (
	"id" text PRIMARY KEY,
	"token" text UNIQUE,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"refresh_id" text,
	"expires_at" timestamp,
	"created_at" timestamp,
	"revoked" timestamp,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_client" (
	"id" text PRIMARY KEY,
	"client_id" text NOT NULL UNIQUE,
	"client_secret" text,
	"client_discovery_id" text,
	"disabled" boolean DEFAULT false,
	"skip_consent" boolean,
	"enable_end_session" boolean,
	"subject_type" text,
	"scopes" text[],
	"client_credentials_scopes" text[] DEFAULT '{}'::text[],
	"user_id" text,
	"created_at" timestamp,
	"updated_at" timestamp,
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" text[],
	"tos" text,
	"policy" text,
	"software_id" text,
	"software_version" text,
	"software_statement" text,
	"redirect_uris" text[] NOT NULL,
	"post_logout_redirect_uris" text[],
	"backchannel_logout_uri" text,
	"backchannel_logout_session_required" boolean,
	"token_endpoint_auth_method" text,
	"application_type" text,
	"jwks" text,
	"jwks_uri" text,
	"grant_types" text[],
	"response_types" text[],
	"require_pkce" boolean,
	"dpop_bound_access_tokens" boolean DEFAULT false,
	"reference_id" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "oauth_client_assertion" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_client_resource" (
	"id" text PRIMARY KEY,
	"client_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "oauth_code_approval" (
	"code_id" text PRIMARY KEY,
	"consent_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_consent" (
	"id" text PRIMARY KEY,
	"client_id" text NOT NULL,
	"user_id" text,
	"reference_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"scopes" text[] NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "oauth_refresh_token" (
	"id" text PRIMARY KEY,
	"token" text NOT NULL UNIQUE,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text NOT NULL,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"expires_at" timestamp,
	"created_at" timestamp,
	"revoked" timestamp,
	"rotated_at" timestamp,
	"rotation_replay_response" text,
	"rotation_replay_expires_at" timestamp,
	"auth_time" timestamp,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_resource" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"access_token_ttl" integer,
	"refresh_token_ttl" integer,
	"signing_algorithm" text,
	"signing_key_id" text,
	"allowed_scopes" text[],
	"custom_claims" jsonb,
	"dpop_bound_access_tokens_required" boolean DEFAULT false,
	"disabled" boolean DEFAULT false,
	"created_at" timestamp,
	"updated_at" timestamp,
	"policy_version" integer DEFAULT 1,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE INDEX "oauthAccessToken_clientId_idx" ON "oauth_access_token" ("client_id");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_sessionId_idx" ON "oauth_access_token" ("session_id");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_userId_idx" ON "oauth_access_token" ("user_id");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_authorizationCodeId_idx" ON "oauth_access_token" ("authorization_code_id");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_refreshId_idx" ON "oauth_access_token" ("refresh_id");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_expiresAt_idx" ON "oauth_access_token" ("expires_at");--> statement-breakpoint
CREATE INDEX "oauthClient_userId_idx" ON "oauth_client" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauthClientResource_clientId_resourceId_uidx" ON "oauth_client_resource" ("client_id","resource_id");--> statement-breakpoint
CREATE INDEX "oauthClientResource_clientId_idx" ON "oauth_client_resource" ("client_id");--> statement-breakpoint
CREATE INDEX "oauthClientResource_resourceId_idx" ON "oauth_client_resource" ("resource_id");--> statement-breakpoint
CREATE INDEX "oauthCodeApproval_consentId_idx" ON "oauth_code_approval" ("consent_id");--> statement-breakpoint
CREATE INDEX "oauthConsent_clientId_idx" ON "oauth_consent" ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauthConsent_userId_clientId_uidx" ON "oauth_consent" ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_clientId_idx" ON "oauth_refresh_token" ("client_id");--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_sessionId_idx" ON "oauth_refresh_token" ("session_id");--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_userId_idx" ON "oauth_refresh_token" ("user_id");--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_authorizationCodeId_idx" ON "oauth_refresh_token" ("authorization_code_id");--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_expiresAt_idx" ON "oauth_refresh_token" ("expires_at");--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_client_id_oauth_client_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_NgXJwWr6Wr8K_fkey" FOREIGN KEY ("authorization_code_id") REFERENCES "oauth_code_approval"("code_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_refresh_id_oauth_refresh_token_id_fkey" FOREIGN KEY ("refresh_id") REFERENCES "oauth_refresh_token"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD CONSTRAINT "oauth_client_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_client_id_oauth_client_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_dn2L1gs9Dolm_fkey" FOREIGN KEY ("resource_id") REFERENCES "oauth_resource"("identifier") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_code_approval" ADD CONSTRAINT "oauth_code_approval_consent_id_oauth_consent_id_fkey" FOREIGN KEY ("consent_id") REFERENCES "oauth_consent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_client_id_oauth_client_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_client_id_oauth_client_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_rEBbO0vftDUD_fkey" FOREIGN KEY ("authorization_code_id") REFERENCES "oauth_code_approval"("code_id") ON DELETE CASCADE;--> statement-breakpoint
-- Better Auth looks for an approval and inserts one when it finds none, so approvals racing
-- for the same account and app both insert. Approvals of an account take turns on its user
-- row, and an insert that finds an approval updates it instead: the approval keeps its ID and
-- carries the latest decision. Recovery holds that row until the account's sessions are gone,
-- so an approval racing it is refused rather than letting the app's next authorization skip
-- consent. Only an approval stalled after Better Auth checked its session until the owner has
-- signed in again would pass; that window is the request's own few milliseconds.
CREATE FUNCTION index_oauth_consent_merge() RETURNS trigger LANGUAGE plpgsql AS $$
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
--> statement-breakpoint
CREATE TRIGGER oauth_consent_merge BEFORE INSERT ON oauth_consent
FOR EACH ROW EXECUTE FUNCTION index_oauth_consent_merge();
--> statement-breakpoint
-- Better Auth stores an authorization code as a verification row whose identifier is the
-- code's digest, the `authorization_code_id` of every token it leads to. The code is bound to
-- its account's approval of the app as it is stored; without one, no code is issued. A code
-- stored after the user disconnected and reconnected the same app binds to the new approval,
-- whose permissions it then cannot exceed. Unrecognized rows are left alone, so a changed code
-- format leaves codes unbound and their exchange fails on the token foreign key.
CREATE FUNCTION index_oauth_code_issued() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE code jsonb; approval text;
BEGIN
  IF NEW.value NOT LIKE '{%' THEN RETURN NEW; END IF;
  BEGIN
    code := NEW.value::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NEW;
  END;
  IF code->>'type' IS DISTINCT FROM 'authorization_code' THEN RETURN NEW; END IF;
  SELECT id INTO approval FROM oauth_consent
  WHERE user_id=code->>'userId' AND client_id=code->'query'->>'client_id' FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'authorization code without an approval' USING ERRCODE='foreign_key_violation';
  END IF;
  INSERT INTO oauth_code_approval (code_id, consent_id) VALUES (NEW.identifier, approval);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER oauth_code_issued AFTER INSERT ON verification
FOR EACH ROW EXECUTE FUNCTION index_oauth_code_issued();
--> statement-breakpoint
-- A deleted approval takes its pending codes with it.
CREATE FUNCTION index_oauth_code_revoked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM verification WHERE identifier=OLD.code_id;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER oauth_code_revoked AFTER DELETE ON oauth_code_approval
FOR EACH ROW EXECUTE FUNCTION index_oauth_code_revoked();
--> statement-breakpoint
-- Expired OAuth tokens join the bounded auth cleanup. Rotated refresh tokens stay until they
-- expire, so presenting one again still revokes its whole token family. Code bindings outlive
-- their code by a day and then last as long as a token of theirs.
CREATE OR REPLACE FUNCTION index_auth_cleanup() RETURNS integer LANGUAGE sql AS $$
  WITH codes AS (
    DELETE FROM auth_challenge WHERE key IN (
      SELECT key FROM auth_challenge WHERE expires_at < now()-interval '1 day'
      ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED
    ) RETURNING key
  ), limits AS (
    DELETE FROM auth_throttle WHERE key IN (
      SELECT key FROM auth_throttle WHERE expires_at < now()-interval '1 day'
      ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED
    ) RETURNING key
  ), access_tokens AS (
    DELETE FROM oauth_access_token WHERE id IN (
      SELECT id FROM oauth_access_token
      WHERE expires_at < (now() AT TIME ZONE 'UTC')-interval '1 day'
      ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED
    ) RETURNING id
  ), refresh_tokens AS (
    DELETE FROM oauth_refresh_token WHERE id IN (
      SELECT id FROM oauth_refresh_token
      WHERE expires_at < (now() AT TIME ZONE 'UTC')-interval '1 day'
      ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED
    ) RETURNING id
  ), code_approvals AS (
    DELETE FROM oauth_code_approval WHERE code_id IN (
      SELECT code_id FROM oauth_code_approval AS binding
      WHERE created_at < now()-interval '1 day'
        AND NOT EXISTS (SELECT 1 FROM oauth_access_token WHERE authorization_code_id=binding.code_id)
        AND NOT EXISTS (SELECT 1 FROM oauth_refresh_token WHERE authorization_code_id=binding.code_id)
      ORDER BY created_at LIMIT 1000 FOR UPDATE SKIP LOCKED
    ) RETURNING code_id
  ) SELECT ((SELECT count(*) FROM codes)+(SELECT count(*) FROM limits)
    +(SELECT count(*) FROM access_tokens)+(SELECT count(*) FROM refresh_tokens)
    +(SELECT count(*) FROM code_approvals))::integer
$$;
--> statement-breakpoint
-- Recovery also disconnects every app: deleting the account's approvals deletes their pending
-- codes and tokens, in the transaction that replaces the password and holds the account's user
-- row. Signing out keeps apps connected.
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
END $$;
