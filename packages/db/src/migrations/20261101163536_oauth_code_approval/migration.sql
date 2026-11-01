CREATE TABLE "oauth_code_approval" (
	"code_id" text PRIMARY KEY,
	"consent_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "oauthCodeApproval_consentId_idx" ON "oauth_code_approval" ("consent_id");--> statement-breakpoint
ALTER TABLE "oauth_code_approval" ADD CONSTRAINT "oauth_code_approval_consent_id_oauth_consent_id_fkey" FOREIGN KEY ("consent_id") REFERENCES "oauth_consent"("id") ON DELETE CASCADE;--> statement-breakpoint
-- Existing token families belong to their account's approval of the app, unless they are older
-- than it: Better Auth creates an approval only when none exists, so such a family was issued
-- under an approval deleted since and must not count again.
INSERT INTO "oauth_code_approval" ("code_id", "consent_id")
SELECT "family"."code_id", "oauth_consent"."id"
FROM (
  SELECT "authorization_code_id" AS "code_id", "user_id", "client_id", min("created_at") AS "issued_at"
  FROM (
    SELECT "authorization_code_id", "user_id", "client_id", "created_at" FROM "oauth_access_token"
    UNION ALL
    SELECT "authorization_code_id", "user_id", "client_id", "created_at" FROM "oauth_refresh_token"
  ) AS "token"
  WHERE "authorization_code_id" IS NOT NULL
  GROUP BY 1, 2, 3
) AS "family"
JOIN "oauth_consent" ON "oauth_consent"."user_id" = "family"."user_id"
  AND "oauth_consent"."client_id" = "family"."client_id"
WHERE "family"."issued_at" >= "oauth_consent"."created_at"
ON CONFLICT ("code_id") DO NOTHING;--> statement-breakpoint
DELETE FROM "oauth_refresh_token" WHERE "authorization_code_id" IS NULL OR NOT EXISTS (
  SELECT 1 FROM "oauth_code_approval" WHERE "code_id" = "oauth_refresh_token"."authorization_code_id"
);--> statement-breakpoint
DELETE FROM "oauth_access_token" WHERE "authorization_code_id" IS NULL OR NOT EXISTS (
  SELECT 1 FROM "oauth_code_approval" WHERE "code_id" = "oauth_access_token"."authorization_code_id"
);--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_NgXJwWr6Wr8K_fkey" FOREIGN KEY ("authorization_code_id") REFERENCES "oauth_code_approval"("code_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_rEBbO0vftDUD_fkey" FOREIGN KEY ("authorization_code_id") REFERENCES "oauth_code_approval"("code_id") ON DELETE CASCADE;--> statement-breakpoint
-- Better Auth stores an authorization code as a verification row whose identifier is the
-- code's digest, the `authorization_code_id` of every token it leads to. The code is bound to
-- its account's approval of the app as it is stored; without one, no code is issued.
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
END $$;--> statement-breakpoint
CREATE TRIGGER oauth_code_issued AFTER INSERT ON verification
FOR EACH ROW EXECUTE FUNCTION index_oauth_code_issued();--> statement-breakpoint
-- A deleted approval takes its pending codes with it.
CREATE FUNCTION index_oauth_code_revoked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM verification WHERE identifier=OLD.code_id;
  RETURN OLD;
END $$;--> statement-breakpoint
CREATE TRIGGER oauth_code_revoked AFTER DELETE ON oauth_code_approval
FOR EACH ROW EXECUTE FUNCTION index_oauth_code_revoked();--> statement-breakpoint
-- Bindings outlive their code by a day and then last as long as a token of theirs.
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
