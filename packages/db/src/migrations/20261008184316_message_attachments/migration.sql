ALTER TABLE "messages" ADD COLUMN "has_attachment" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE messages SET has_attachment = true WHERE link_id IS NOT NULL OR body = '';
