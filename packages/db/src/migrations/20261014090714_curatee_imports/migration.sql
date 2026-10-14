CREATE TABLE "curatee_imports" (
	"owner_id" text,
	"curatee_id" uuid,
	"link_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "curatee_imports_pkey" PRIMARY KEY("owner_id","curatee_id")
);
--> statement-breakpoint
ALTER TABLE "curatee_imports" ADD CONSTRAINT "curatee_imports_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "curatee_imports" ADD CONSTRAINT "curatee_imports_link_id_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "links"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- One statement, so an import is atomic with Neon HTTP as well as ordinary PostgreSQL. Each
-- curatee link is claimed before its link is saved: a repeated or concurrent import of the same
-- profile skips what is already claimed, including links deleted since.
CREATE FUNCTION index_import_curatee(actor text, items jsonb) RETURNS integer LANGUAGE sql AS $$
  WITH incoming AS MATERIALIZED (
    SELECT gen_random_uuid() AS link_id, item.*
    FROM jsonb_to_recordset(items) AS item(
      curatee_id uuid, url text, title text, description text, category text, created_at timestamptz
    )
  ), claimed AS (
    INSERT INTO curatee_imports(owner_id, curatee_id, link_id)
    SELECT actor, curatee_id, link_id FROM incoming
    ON CONFLICT DO NOTHING
    RETURNING link_id
  ), saved AS (
    INSERT INTO links(id, owner_id, url, title, description, category, saved_on, created_at)
    SELECT link_id, actor, url, title, description, category,
      (created_at AT TIME ZONE 'UTC')::date, created_at
    FROM incoming JOIN claimed USING (link_id)
    RETURNING 1
  )
  SELECT count(*)::int FROM saved
$$;
