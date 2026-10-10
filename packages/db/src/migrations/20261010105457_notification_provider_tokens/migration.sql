CREATE TABLE "notification_provider_tokens" (
	"key" text PRIMARY KEY,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
