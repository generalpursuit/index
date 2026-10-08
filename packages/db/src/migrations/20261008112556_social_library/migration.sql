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
	CONSTRAINT "groups_kind_check" CHECK ("kind" in ('custom', 'starred')),
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
	"category" text DEFAULT 'uncategorized' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "links_url_not_empty" CHECK (length(btrim("url")) > 0),
	CONSTRAINT "links_title_not_empty" CHECK (length(btrim("title")) > 0),
	CONSTRAINT "links_category_check" CHECK ("category" in ('uncategorized', 'article', 'podcast', 'music', 'video', 'book', 'tool', 'note'))
);
--> statement-breakpoint
CREATE TABLE "stars" (
	"group_id" uuid,
	"link_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stars_pkey" PRIMARY KEY("group_id","link_id")
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "profile_visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_username_key" UNIQUE("username");--> statement-breakpoint
CREATE INDEX "comments_link_created_at_id_idx" ON "comments" ("link_id","created_at","id");--> statement-breakpoint
CREATE INDEX "comments_author_id_idx" ON "comments" ("author_id");--> statement-breakpoint
CREATE INDEX "follows_incoming_idx" ON "follows" ("followed_id","status","created_at" DESC NULLS LAST,"follower_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_one_starred_per_owner" ON "groups" ("owner_id") WHERE "kind" = 'starred';--> statement-breakpoint
CREATE INDEX "links_owner_created_at_id_idx" ON "links" ("owner_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "links_group_created_at_id_idx" ON "links" ("group_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "stars_group_created_at_link_idx" ON "stars" ("group_id","created_at" DESC NULLS LAST,"link_id");--> statement-breakpoint
CREATE INDEX "stars_link_id_idx" ON "stars" ("link_id");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_link_id_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_user_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_user_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_followed_id_user_id_fkey" FOREIGN KEY ("followed_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_owner_group_fk" FOREIGN KEY ("owner_id","group_id") REFERENCES "groups"("owner_id","id");--> statement-breakpoint
ALTER TABLE "stars" ADD CONSTRAINT "stars_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "stars" ADD CONSTRAINT "stars_link_id_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_profile_visibility_check" CHECK ("profile_visibility" in ('public', 'private'));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_username_normalized_check" CHECK ("username" = lower(btrim("username")) AND length("username") > 0);