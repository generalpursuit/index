CREATE TABLE "group_aliases" (
	"owner_id" text,
	"slug" text,
	"group_id" uuid,
	CONSTRAINT "group_aliases_pkey" PRIMARY KEY("owner_id","slug")
);
--> statement-breakpoint
CREATE TABLE "short_routes" (
	"short_id" text PRIMARY KEY,
	"kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	CONSTRAINT "short_routes_target_unique" UNIQUE("kind","target_id")
);
--> statement-breakpoint
CREATE TABLE "username_aliases" (
	"username" text PRIMARY KEY,
	"user_id" text
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "short_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "slug" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "short_id" text DEFAULT '' NOT NULL;--> statement-breakpoint


-- These immutable functions are the single database normalization contract.
CREATE FUNCTION public.index_group_name(value text) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT btrim(regexp_replace(normalize(value, NFKC), '[' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || ' ]+', ' ', 'g'), ' ' || chr(65279))
$$;
CREATE FUNCTION public.index_group_name_key(value text) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT lower(public.index_group_name(value))
$$;
CREATE FUNCTION public.index_group_slug(value text) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT coalesce(nullif(btrim(regexp_replace(translate(public.index_group_name(value), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '[^a-z0-9]+', '-', 'g'), '-'), ''), 'group')
$$;
-- Deterministic duplicate repair, preserving every group and its original UUID/links.
-- System groups win. Other groups win by creation time, then UUID. Losers get (2), (3), ... .
DO $$
DECLARE item record; candidate text; suffix integer; base text;
BEGIN
  FOR item IN SELECT * FROM groups ORDER BY (kind = 'custom'), created_at, id LOOP
    base := CASE WHEN item.kind = 'custom' THEN public.index_group_name(item.name)
      WHEN item.kind = 'favorites' THEN 'Favorites' ELSE 'Starred' END;
    candidate := base; suffix := 1;
    WHILE EXISTS(SELECT 1 FROM groups g WHERE g.owner_id=item.owner_id AND g.id<>item.id AND g.slug<>''
      AND (public.index_group_name_key(g.name)=public.index_group_name_key(candidate) OR g.slug=public.index_group_slug(candidate)))
      OR (item.kind='custom' AND public.index_group_slug(candidate) IN ('all','favorites','starred','settings')) LOOP
      suffix := suffix + 1;
      candidate := left(base, 90) || ' (' || suffix || ')';
    END LOOP;
    UPDATE groups SET name=candidate, slug=public.index_group_slug(candidate) WHERE id=item.id;
  END LOOP;
END $$;
-- Existing handles already satisfy the initial lowercase/trim constraint. Preserve them.
INSERT INTO username_aliases(username,user_id) SELECT username,id FROM "user" WHERE username IS NOT NULL;
-- Legacy accounts without handles receive deterministic, collision-checked handles.
DO $$
DECLARE item record; candidate text; suffix integer;
BEGIN
  FOR item IN SELECT id FROM "user" WHERE username IS NULL ORDER BY id LOOP
    candidate := 'member_' || left(md5(item.id), 16); suffix := 0;
    WHILE EXISTS(SELECT 1 FROM username_aliases WHERE username=candidate) LOOP
      suffix := suffix+1; candidate := 'member_' || left(md5(item.id),16) || '_' || suffix;
    END LOOP;
    UPDATE "user" SET username=candidate WHERE id=item.id;
    INSERT INTO username_aliases VALUES(candidate,item.id);
  END LOOP;
END $$;
INSERT INTO group_aliases(owner_id,slug,group_id) SELECT owner_id,slug,id FROM groups;

CREATE FUNCTION public.index_default_username() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.username IS NULL THEN NEW.username := 'member_' || left(md5(NEW.id),16); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER default_username BEFORE INSERT ON "user" FOR EACH ROW EXECUTE FUNCTION public.index_default_username();
CREATE FUNCTION public.index_reserve_username() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE holder text;
BEGIN
  IF NEW.username IS NULL THEN
    RAISE EXCEPTION 'Choose a username' USING ERRCODE='23514';
  END IF;
  INSERT INTO username_aliases(username,user_id) VALUES(NEW.username,NEW.id)
    ON CONFLICT(username) DO UPDATE SET username=excluded.username
    RETURNING user_id INTO holder;
  IF holder IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'Username is reserved' USING ERRCODE='23505', CONSTRAINT='username_aliases_pkey';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reserve_username AFTER INSERT OR UPDATE OF username ON "user"
  FOR EACH ROW EXECUTE FUNCTION public.index_reserve_username();
CREATE FUNCTION public.index_set_group_slug() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.name := public.index_group_name(NEW.name);
  NEW.slug := public.index_group_slug(NEW.name);
  IF NEW.kind='custom' AND NEW.slug IN ('all','favorites','starred','settings') THEN
    RAISE EXCEPTION 'Group name is reserved' USING ERRCODE='23505', CONSTRAINT='group_aliases_pkey';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.owner_id<>OLD.owner_id OR NEW.kind<>OLD.kind) THEN
    RAISE EXCEPTION 'Group namespace is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER set_group_slug BEFORE INSERT OR UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION public.index_set_group_slug();
CREATE FUNCTION public.index_reserve_group_slug() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE holder uuid;
BEGIN
  INSERT INTO group_aliases(owner_id,slug,group_id) VALUES(NEW.owner_id,NEW.slug,NEW.id)
    ON CONFLICT(owner_id,slug) DO UPDATE SET slug=excluded.slug RETURNING group_id INTO holder;
  IF holder IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'Group address is reserved' USING ERRCODE='23505', CONSTRAINT='group_aliases_pkey';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reserve_group_slug AFTER INSERT OR UPDATE OF name,slug ON groups
  FOR EACH ROW EXECUTE FUNCTION public.index_reserve_group_slug();
-- A global registry reserves short IDs permanently, including deleted records.
CREATE FUNCTION public.index_short_candidate() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT translate(encode(substring(decode(replace(gen_random_uuid()::text,'-',''),'hex') from 1 for 12),'base64'), '+/', '-_')
$$;
CREATE FUNCTION public.index_allocate_short_id(resource_kind text, resource_id uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE candidate text; attempt integer; allocated text;
BEGIN
  SELECT short_id INTO allocated FROM short_routes WHERE kind=resource_kind AND target_id=resource_id;
  IF allocated IS NOT NULL THEN RETURN allocated; END IF;
  FOR attempt IN 1..16 LOOP
    candidate := public.index_short_candidate();
    INSERT INTO short_routes VALUES(candidate,resource_kind,resource_id) ON CONFLICT DO NOTHING RETURNING short_id INTO allocated;
    IF allocated IS NOT NULL THEN RETURN allocated; END IF;
  END LOOP;
  RAISE EXCEPTION 'Short address allocation failed' USING ERRCODE='23505';
END $$;
UPDATE links SET short_id=public.index_allocate_short_id('link',id);
UPDATE conversations SET short_id=public.index_allocate_short_id('conversation',id);
CREATE FUNCTION public.index_set_short_id() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.short_id<>OLD.short_id OR NEW.id<>OLD.id) THEN
    RAISE EXCEPTION 'Short addresses are immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN NEW.short_id := public.index_allocate_short_id(TG_ARGV[0],NEW.id); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER set_link_short_id BEFORE INSERT OR UPDATE ON links
  FOR EACH ROW EXECUTE FUNCTION public.index_set_short_id('link');
CREATE TRIGGER set_conversation_short_id BEFORE INSERT OR UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION public.index_set_short_id('conversation');

ALTER TABLE "groups" ADD CONSTRAINT "groups_owner_slug_unique" UNIQUE("owner_id","slug");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_short_id_key" UNIQUE("short_id");--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_short_id_key" UNIQUE("short_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_owner_name_unique" ON "groups" ("owner_id",public.index_group_name_key("name"));--> statement-breakpoint
ALTER TABLE "group_aliases" ADD CONSTRAINT "group_aliases_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "group_aliases" ADD CONSTRAINT "group_aliases_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "username_aliases" ADD CONSTRAINT "username_aliases_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL;