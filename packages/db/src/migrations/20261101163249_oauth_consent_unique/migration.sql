-- One approval per account and app. Racing first approvals each inserted a row and a later
-- re-approval changed only one of them; keep each pair's latest decision.
DELETE FROM "oauth_consent" AS "stale" USING "oauth_consent" AS "kept"
WHERE "stale"."user_id" = "kept"."user_id" AND "stale"."client_id" = "kept"."client_id"
  AND (coalesce("stale"."updated_at", "stale"."created_at", '-infinity'), "stale"."id")
    < (coalesce("kept"."updated_at", "kept"."created_at", '-infinity'), "kept"."id");--> statement-breakpoint
DROP INDEX "oauthConsent_userId_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "oauthConsent_userId_clientId_uidx" ON "oauth_consent" ("user_id","client_id");--> statement-breakpoint
-- Better Auth looks for an approval and inserts one when it finds none, so approvals racing
-- for the same account and app both insert. Approvals of an account take turns on its user
-- row, and an insert that finds an approval updates it instead: the approval keeps its ID and
-- carries the latest decision.
CREATE FUNCTION index_oauth_consent_merge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "user" WHERE id=NEW.user_id FOR NO KEY UPDATE;
  UPDATE oauth_consent SET scopes=NEW.scopes, resources=NEW.resources,
    requested_user_info_claims=NEW.requested_user_info_claims, reference_id=NEW.reference_id,
    updated_at=NEW.updated_at
  WHERE user_id=NEW.user_id AND client_id=NEW.client_id;
  IF FOUND THEN RETURN NULL; END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER oauth_consent_merge BEFORE INSERT ON oauth_consent
FOR EACH ROW EXECUTE FUNCTION index_oauth_consent_merge();
