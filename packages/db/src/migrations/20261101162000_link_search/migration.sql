-- Trigram GIN indexes serve case-insensitive substring search (ILIKE '%word%') per column.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX "links_search_trgm_idx" ON "links" USING gin ("title" gin_trgm_ops,"url" gin_trgm_ops,"description" gin_trgm_ops);
