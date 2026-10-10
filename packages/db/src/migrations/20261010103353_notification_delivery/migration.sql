CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"event_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease" uuid,
	"outcome" jsonb,
	CONSTRAINT "notification_delivery_unique" UNIQUE("event_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "notification_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"installation_hash" text NOT NULL UNIQUE,
	"endpoint_hash" text UNIQUE,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"kind" text NOT NULL,
	"endpoint" text,
	"p256dh" text,
	"auth" text,
	"environment" text,
	"active_conversation_id" uuid,
	"active_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_device_kind" CHECK ("kind" in ('web','apns','desktop'))
);
--> statement-breakpoint
CREATE TABLE "notification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"recipient_id" text NOT NULL,
	"category" text NOT NULL,
	"activity_id" uuid,
	"message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_event_activity_unique" UNIQUE("recipient_id","activity_id"),
	CONSTRAINT "notification_event_message_unique" UNIQUE("recipient_id","message_id"),
	CONSTRAINT "notification_event_source" CHECK (("activity_id" is null) <> ("message_id" is null))
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" text PRIMARY KEY,
	"message" boolean DEFAULT true NOT NULL,
	"comment" boolean DEFAULT true NOT NULL,
	"mention" boolean DEFAULT true NOT NULL,
	"request" boolean DEFAULT true NOT NULL,
	"follow" boolean DEFAULT true NOT NULL,
	"accepted" boolean DEFAULT true NOT NULL,
	"previews" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notification_delivery_due_idx" ON "notification_deliveries" ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "notification_devices_user_idx" ON "notification_devices" ("user_id");--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_event_id_notification_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "notification_events"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_device_id_notification_devices_id_fkey" FOREIGN KEY ("device_id") REFERENCES "notification_devices"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_devices" ADD CONSTRAINT "notification_devices_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_devices" ADD CONSTRAINT "notification_devices_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_recipient_id_user_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_activity_id_activities_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_message_id_messages_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
-- Transactional outbox. These triggers observe existing atomic activity/message writes;
-- rollback, idempotent sends and failed mutations cannot leave orphan alerts.
CREATE FUNCTION index_notification_fanout() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO notification_deliveries (event_id, device_id)
    SELECT NEW.id, d.id FROM notification_devices d
    JOIN session s ON s.id = d.session_id AND s.user_id = d.user_id
    JOIN "user" u ON u.id = d.user_id
    WHERE d.user_id = NEW.recipient_id AND u.email_verified AND s.expires_at > now()
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER notification_fanout AFTER INSERT ON notification_events
  FOR EACH ROW EXECUTE FUNCTION index_notification_fanout();
CREATE FUNCTION index_notification_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.recipient_id <> NEW.actor_id THEN
    INSERT INTO notification_events (recipient_id, category, activity_id)
      VALUES (NEW.recipient_id, NEW.type, NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notification_activity AFTER INSERT ON activities
  FOR EACH ROW EXECUTE FUNCTION index_notification_activity();
CREATE FUNCTION index_notification_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO notification_events (recipient_id, category, message_id)
    SELECT user_id, 'message', NEW.id FROM conversation_members
    WHERE conversation_id = NEW.conversation_id AND user_id <> NEW.sender_id
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER notification_message AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION index_notification_message();

-- One statement works with Neon HTTP. A lease recovers interrupted Workers; SKIP LOCKED
-- prevents concurrent scheduled invocations / desktop polls from claiming the same job.
CREATE FUNCTION index_notification_claim(p_device uuid DEFAULT NULL, p_limit integer DEFAULT 40)
RETURNS SETOF notification_deliveries LANGUAGE sql AS $$
  UPDATE notification_deliveries d SET lease = gen_random_uuid(), attempts = d.attempts + 1,
    next_attempt_at = now() + interval '2 minutes'
  WHERE d.id IN (
    SELECT q.id FROM notification_deliveries q
    JOIN notification_devices dev ON dev.id = q.device_id
    WHERE q.state = 'pending' AND q.attempts < 8 AND q.next_attempt_at <= now()
      AND ((p_device IS NULL AND dev.kind <> 'desktop') OR (dev.id = p_device AND dev.kind = 'desktop'))
    ORDER BY q.next_attempt_at, q.id LIMIT LEAST(GREATEST(p_limit, 1), 100)
    FOR UPDATE OF q SKIP LOCKED
  ) RETURNING d.*;
$$;

-- An installation changing accounts/sessions must never inherit queued alerts.
CREATE FUNCTION index_notification_rebind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.user_id <> NEW.user_id OR OLD.session_id <> NEW.session_id THEN
    DELETE FROM notification_deliveries WHERE device_id = OLD.id;
    NEW.active_conversation_id := NULL;
    NEW.active_until := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notification_rebind BEFORE UPDATE ON notification_devices
  FOR EACH ROW EXECUTE FUNCTION index_notification_rebind();
