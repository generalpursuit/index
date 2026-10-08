import { err, ok, Result } from "neverthrow";
import { z } from "zod";

const cursorSchema = z.strictObject({
  // ISO 8601 allows year zero, but PostgreSQL timestamps do not.
  createdAt: z.iso.datetime().refine((value) => !value.startsWith("0000-")),
  id: z.uuid(),
});

export type Cursor = z.output<typeof cursorSchema>;

const invalidCursor = () => ({ code: "BAD_REQUEST" as const, message: "Invalid cursor." });

const parseCursor = Result.fromThrowable(
  (cursor: string): unknown => JSON.parse(atob(cursor.replaceAll("-", "+").replaceAll("_", "/"))),
  invalidCursor,
);

export function decodeCursor(cursor: string) {
  return parseCursor(cursor).andThen((value) => {
    const parsed = cursorSchema.safeParse(value);
    return parsed.success ? ok(parsed.data) : err(invalidCursor());
  });
}

export function encodeCursor({ createdAt, id }: Cursor): string {
  return btoa(JSON.stringify({ createdAt, id }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function toPage<T extends Cursor>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last) : null };
}
