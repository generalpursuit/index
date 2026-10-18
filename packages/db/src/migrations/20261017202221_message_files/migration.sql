CREATE TABLE "message_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"conversation_id" uuid NOT NULL,
	"uploader_id" text NOT NULL,
	"message_id" uuid,
	"object_key" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "file_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
CREATE INDEX "message_files_message_idx" ON "message_files" ("message_id");--> statement-breakpoint
CREATE INDEX "message_files_staged_idx" ON "message_files" ("created_at") WHERE "message_id" is null;--> statement-breakpoint
ALTER TABLE "message_files" ADD CONSTRAINT "message_files_conversation_id_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "message_files" ADD CONSTRAINT "message_files_uploader_id_user_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "message_files" ADD CONSTRAINT "message_files_message_id_messages_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE;