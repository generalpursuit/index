CREATE TABLE "share_receipts" (
	"owner_id" text,
	"request_id" uuid,
	"payload" text NOT NULL,
	"link_id" uuid,
	"saved" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_receipts_pkey" PRIMARY KEY("owner_id","request_id")
);
--> statement-breakpoint
ALTER TABLE "share_receipts" ADD CONSTRAINT "share_receipts_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "share_receipts" ADD CONSTRAINT "share_receipts_link_id_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "links"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- One server-side transaction works with Neon HTTP as well as ordinary PostgreSQL.
-- The owner row serializes independent share attempts, including different request IDs.
CREATE OR REPLACE FUNCTION index_share_link(
  actor text, request uuid, address text, destination uuid, again boolean,
  page_title text, page_category text
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE receipt share_receipts%ROWTYPE; found_link uuid; did_save boolean;
BEGIN
  PERFORM 1 FROM "user" WHERE id = actor AND email_verified = true FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF destination IS NOT NULL THEN
    PERFORM 1 FROM groups WHERE id = destination AND owner_id = actor AND kind = 'custom' FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  END IF;
  SELECT * INTO receipt FROM share_receipts WHERE owner_id = actor AND request_id = request;
  IF FOUND THEN
    IF receipt.payload <> jsonb_build_array(address, destination, again)::text OR receipt.link_id IS NULL THEN
      RETURN jsonb_build_object('error', 'CONFLICT');
    END IF;
    RETURN jsonb_build_object('status', CASE WHEN receipt.saved THEN 'saved' ELSE 'existing' END, 'linkId', receipt.link_id);
  END IF;
  IF NOT again THEN
    SELECT id INTO found_link FROM links WHERE owner_id = actor AND url = address ORDER BY created_at DESC, id DESC LIMIT 1;
  END IF;
  did_save := found_link IS NULL;
  IF did_save THEN
    INSERT INTO links(owner_id, group_id, url, title, category)
      VALUES(actor, destination, address, page_title, page_category) RETURNING id INTO found_link;
  END IF;
  INSERT INTO share_receipts(owner_id, request_id, payload, link_id, saved)
    VALUES(actor, request, jsonb_build_array(address, destination, again)::text, found_link, did_save);
  RETURN jsonb_build_object('status', CASE WHEN did_save THEN 'saved' ELSE 'existing' END, 'linkId', found_link);
END $$;
