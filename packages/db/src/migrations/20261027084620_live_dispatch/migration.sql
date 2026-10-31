CREATE TABLE "live_changes" (
	"user_id" text PRIMARY KEY,
	"version" uuid DEFAULT gen_random_uuid() NOT NULL,
	"session_changed" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Hints carry no content and survive a Worker dying after a domain commit. Replacing the
-- version on every change lets a dispatcher acknowledge without erasing a concurrent write.
CREATE FUNCTION index_live_changed(p_user text, p_session boolean DEFAULT false)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO live_changes(user_id, session_changed) SELECT p_user, p_session WHERE p_user IS NOT NULL
  ON CONFLICT (user_id) DO UPDATE SET version=gen_random_uuid(), updated_at=now(),
    session_changed=live_changes.session_changed OR excluded.session_changed;
$$;
CREATE FUNCTION index_live_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM index_live_changed(OLD.recipient_id); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM index_live_changed(NEW.recipient_id); END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER live_activity AFTER INSERT OR UPDATE OR DELETE ON activities
  FOR EACH ROW EXECUTE FUNCTION index_live_activity();
CREATE FUNCTION index_live_conversation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c uuid; member text;
BEGIN
  IF TG_TABLE_NAME = 'conversations' THEN
    c := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    c := CASE WHEN TG_OP = 'DELETE' THEN OLD.conversation_id ELSE NEW.conversation_id END;
  END IF;
  FOR member IN SELECT user_id FROM conversation_members WHERE conversation_id=c LOOP
    PERFORM index_live_changed(member);
  END LOOP;
  IF TG_TABLE_NAME = 'conversation_members' THEN
    IF TG_OP <> 'INSERT' THEN PERFORM index_live_changed(OLD.user_id); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM index_live_changed(NEW.user_id); END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER live_message AFTER INSERT OR UPDATE OR DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION index_live_conversation();
CREATE TRIGGER live_member AFTER INSERT OR UPDATE OR DELETE ON conversation_members
  FOR EACH ROW EXECUTE FUNCTION index_live_conversation();
CREATE TRIGGER live_conversation AFTER UPDATE OR DELETE ON conversations
  FOR EACH ROW EXECUTE FUNCTION index_live_conversation();
CREATE FUNCTION index_live_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM index_live_changed(OLD.user_id, true);
  RETURN NULL;
END $$;
CREATE TRIGGER live_session AFTER DELETE ON session
  FOR EACH ROW EXECUTE FUNCTION index_live_session();
CREATE FUNCTION index_live_profile() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recipient text;
BEGIN
  PERFORM index_live_changed(NEW.id, NEW.email_verified IS DISTINCT FROM OLD.email_verified);
  FOR recipient IN SELECT DISTINCT recipient_id FROM activities
    WHERE actor_id=NEW.id OR link_id IN (SELECT id FROM links WHERE owner_id=NEW.id) LOOP
    PERFORM index_live_changed(recipient);
  END LOOP;
  FOR recipient IN SELECT DISTINCT cm.user_id FROM conversation_members cm
    JOIN messages m ON m.conversation_id=cm.conversation_id JOIN links l ON l.id=m.link_id WHERE l.owner_id=NEW.id LOOP
    PERFORM index_live_changed(recipient);
  END LOOP;
  FOR recipient IN SELECT DISTINCT peer.user_id FROM conversation_members own
    JOIN conversation_members peer ON peer.conversation_id=own.conversation_id WHERE own.user_id=NEW.id LOOP
    PERFORM index_live_changed(recipient);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER live_profile AFTER UPDATE ON "user"
  FOR EACH ROW EXECUTE FUNCTION index_live_profile();
--> statement-breakpoint
-- Visibility/content changes also affect the pulse even when no alert was created.
CREATE FUNCTION index_live_link_changed(p_link uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE recipient text;
BEGIN
  FOR recipient IN
    SELECT recipient_id FROM activities WHERE link_id=p_link
    UNION SELECT cm.user_id FROM messages m JOIN conversation_members cm ON cm.conversation_id=m.conversation_id WHERE m.link_id=p_link
  LOOP PERFORM index_live_changed(recipient); END LOOP;
END $$;
CREATE FUNCTION index_live_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM index_live_link_changed(CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END);
  RETURN NULL;
END $$;
CREATE TRIGGER live_link AFTER UPDATE OR DELETE ON links
  FOR EACH ROW EXECUTE FUNCTION index_live_link();
CREATE FUNCTION index_live_group() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE link uuid;
BEGIN
  FOR link IN SELECT id FROM links WHERE group_id=NEW.id LOOP
    PERFORM index_live_link_changed(link);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER live_group AFTER UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION index_live_group();
CREATE FUNCTION index_live_comment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recipient text;
BEGIN
  FOR recipient IN SELECT recipient_id FROM activities WHERE comment_id=NEW.id LOOP
    PERFORM index_live_changed(recipient);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER live_comment AFTER UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION index_live_comment();
CREATE FUNCTION index_live_follow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM index_live_changed(OLD.follower_id); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM index_live_changed(NEW.follower_id); END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER live_follow AFTER INSERT OR UPDATE OR DELETE ON follows
  FOR EACH ROW EXECUTE FUNCTION index_live_follow();
