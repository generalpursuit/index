CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"recipient_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"type" text NOT NULL,
	"request_status" text,
	"link_id" uuid,
	"comment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "activity_type_check" CHECK ("type" in ('comment', 'follow', 'request', 'accepted')),
	CONSTRAINT "activity_request_status_check" CHECK (("type" = 'request' and "request_status" in ('pending','accepted','declined','canceled')) or ("type" <> 'request' and "request_status" is null)),
	CONSTRAINT "activity_comment_check" CHECK (("type" = 'comment') = ("comment_id" is not null and "link_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "conversation_members" (
	"conversation_id" uuid,
	"user_id" text,
	"read_at" timestamp with time zone,
	"read_message_id" uuid,
	CONSTRAINT "conversation_members_pkey" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"member_key" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favorites" (
	"owner_id" text,
	"link_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorites_pkey" PRIMARY KEY("owner_id","link_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"conversation_id" uuid NOT NULL,
	"sender_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_sender_client_unique" UNIQUE("sender_id","client_id")
);
--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "saved_on" date DEFAULT (now() at time zone 'UTC') NOT NULL;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_owner_id_id_unique" UNIQUE("owner_id","id");--> statement-breakpoint
CREATE INDEX "activities_recipient_created_idx" ON "activities" ("recipient_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activities_pending_request_idx" ON "activities" ("recipient_id","actor_id") WHERE "type" = 'request' and "request_status" = 'pending';--> statement-breakpoint
CREATE INDEX "conversation_members_user_idx" ON "conversation_members" ("user_id","conversation_id");--> statement-breakpoint
CREATE INDEX "conversations_updated_idx" ON "conversations" ("updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "groups_one_favorites_per_owner" ON "groups" ("owner_id") WHERE "kind" = 'favorites';--> statement-breakpoint
CREATE INDEX "links_owner_saved_on_idx" ON "links" ("owner_id","saved_on","id");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" ("conversation_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_recipient_id_user_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_actor_id_user_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_link_id_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_comment_id_comments_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_owner_id_link_id_links_owner_id_id_fkey" FOREIGN KEY ("owner_id","link_id") REFERENCES "links"("owner_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_user_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_link_id_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "links"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_CBgfHJvkP5Wg_fkey" FOREIGN KEY ("conversation_id","sender_id") REFERENCES "conversation_members"("conversation_id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "groups" DROP CONSTRAINT "groups_kind_check", ADD CONSTRAINT "groups_kind_check" CHECK ("kind" in ('custom', 'starred', 'favorites'));
--> statement-breakpoint
UPDATE links SET saved_on = (created_at AT TIME ZONE 'UTC')::date;
--> statement-breakpoint
-- Preserve pre-existing self-stars and the collection's visibility.
INSERT INTO groups(owner_id, name, kind, visibility)
SELECT DISTINCT g.owner_id, 'Favorites', 'favorites', g.visibility
FROM stars s JOIN groups g ON g.id=s.group_id JOIN links l ON l.id=s.link_id
WHERE l.owner_id=g.owner_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO favorites(owner_id, link_id, created_at)
SELECT g.owner_id, s.link_id, s.created_at FROM stars s JOIN groups g ON g.id=s.group_id JOIN links l ON l.id=s.link_id WHERE l.owner_id=g.owner_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
DELETE FROM stars USING groups g, links l WHERE stars.group_id=g.id AND stars.link_id=l.id AND l.owner_id=g.owner_id;

--> statement-breakpoint
-- Existing pending requests must remain actionable in the new Activity view.
INSERT INTO activities(recipient_id, actor_id, type, request_status, created_at)
SELECT followed_id, follower_id, 'request', 'pending', created_at
FROM follows WHERE status='pending';
