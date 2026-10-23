ALTER TABLE "user" ADD COLUMN "is_discoverable" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
-- Apple's review account remains usable without appearing in people discovery.
UPDATE "user" SET "is_discoverable" = false
WHERE lower("email") = 'review@index.invalid';
