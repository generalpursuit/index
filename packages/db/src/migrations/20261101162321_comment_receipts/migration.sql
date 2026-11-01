ALTER TABLE "comments" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_client_unique" UNIQUE("author_id","client_id");