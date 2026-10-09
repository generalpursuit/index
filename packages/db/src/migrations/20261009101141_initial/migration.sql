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
	CONSTRAINT "activity_type_check" CHECK ("type" in ('comment', 'mention', 'follow', 'request', 'accepted')),
	CONSTRAINT "activity_request_status_check" CHECK (("type" = 'request' and "request_status" in ('pending','accepted','declined','canceled')) or ("type" <> 'request' and "request_status" is null)),
	CONSTRAINT "activity_comment_check" CHECK (("type" in ('comment', 'mention')) = ("comment_id" is not null and "link_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"link_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_body_not_empty" CHECK (length(btrim("body")) > 0)
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
CREATE TABLE "follows" (
	"follower_id" text,
	"followed_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "follows_pkey" PRIMARY KEY("follower_id","followed_id"),
	CONSTRAINT "follows_no_self_follow" CHECK ("follower_id" <> "followed_id"),
	CONSTRAINT "follows_status_check" CHECK ("status" in ('pending', 'accepted')),
	CONSTRAINT "follows_acceptance_check" CHECK (("status" = 'accepted') = ("accepted_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'custom' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "groups_name_not_empty" CHECK (length(btrim("name")) > 0),
	CONSTRAINT "groups_kind_check" CHECK ("kind" in ('custom', 'starred', 'favorites')),
	CONSTRAINT "groups_visibility_check" CHECK ("visibility" in ('private', 'public'))
);
--> statement-breakpoint
CREATE TABLE "links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_id" text NOT NULL,
	"group_id" uuid,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"saved_on" date DEFAULT (now() at time zone 'UTC') NOT NULL,
	"category" text DEFAULT 'uncategorized' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "links_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "links_url_not_empty" CHECK (length(btrim("url")) > 0),
	CONSTRAINT "links_title_not_empty" CHECK (length(btrim("title")) > 0),
	CONSTRAINT "links_category_check" CHECK ("category" in ('uncategorized', 'article', 'podcast', 'music', 'video', 'book', 'tool', 'note'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"conversation_id" uuid NOT NULL,
	"sender_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"has_attachment" boolean DEFAULT false NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_sender_client_unique" UNIQUE("sender_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "stars" (
	"group_id" uuid,
	"link_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stars_pkey" PRIMARY KEY("group_id","link_id")
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"username" text UNIQUE,
	"profile_visibility" text DEFAULT 'public' NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_profile_visibility_check" CHECK ("profile_visibility" in ('public', 'private')),
	CONSTRAINT "user_username_normalized_check" CHECK ("username" = lower(btrim("username")) AND length("username") > 0)
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "activities_recipient_created_idx" ON "activities" ("recipient_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "activities_comment_recipient_idx" ON "activities" ("comment_id","recipient_id") WHERE "comment_id" is not null;--> statement-breakpoint
CREATE INDEX "activities_pending_request_idx" ON "activities" ("recipient_id","actor_id") WHERE "type" = 'request' and "request_status" = 'pending';--> statement-breakpoint
CREATE INDEX "comments_link_created_at_id_idx" ON "comments" ("link_id","created_at","id");--> statement-breakpoint
CREATE INDEX "comments_author_id_idx" ON "comments" ("author_id");--> statement-breakpoint
CREATE INDEX "conversation_members_user_idx" ON "conversation_members" ("user_id","conversation_id");--> statement-breakpoint
CREATE INDEX "conversations_updated_idx" ON "conversations" ("updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "follows_incoming_idx" ON "follows" ("followed_id","status","created_at" DESC NULLS LAST,"follower_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_one_starred_per_owner" ON "groups" ("owner_id") WHERE "kind" = 'starred';--> statement-breakpoint
CREATE UNIQUE INDEX "groups_one_favorites_per_owner" ON "groups" ("owner_id") WHERE "kind" = 'favorites';--> statement-breakpoint
CREATE INDEX "links_owner_saved_on_idx" ON "links" ("owner_id","saved_on","id");--> statement-breakpoint
CREATE INDEX "links_owner_created_at_id_idx" ON "links" ("owner_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "links_group_created_at_id_idx" ON "links" ("group_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" ("conversation_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "stars_group_created_at_link_idx" ON "stars" ("group_id","created_at" DESC NULLS LAST,"link_id");--> statement-breakpoint
CREATE INDEX "stars_link_id_idx" ON "stars" ("link_id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_recipient_id_user_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_actor_id_user_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_link_id_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_comment_id_comments_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_link_id_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_user_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_owner_id_link_id_links_owner_id_id_fkey" FOREIGN KEY ("owner_id","link_id") REFERENCES "links"("owner_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_user_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_followed_id_user_id_fkey" FOREIGN KEY ("followed_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_owner_group_fk" FOREIGN KEY ("owner_id","group_id") REFERENCES "groups"("owner_id","id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_user_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_link_id_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "links"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_CBgfHJvkP5Wg_fkey" FOREIGN KEY ("conversation_id","sender_id") REFERENCES "conversation_members"("conversation_id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "stars" ADD CONSTRAINT "stars_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "stars" ADD CONSTRAINT "stars_link_id_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;