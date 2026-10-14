import { and, eq, sql } from "drizzle-orm";
import { user, usernameAliases } from "@index/db/schema/auth";
import {
  groups,
  groupAliases,
  links,
  conversations,
  conversationMembers,
} from "@index/db/schema/app";
import { err, ok, type Result } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { groupVisible, linkVisible } from "../../data-access/visibility";
import { databaseError, notFound, type ApplicationError } from "../../errors";
import { conversationPath, groupPath, linkPath, profilePath } from "../../routes";
import { ensureSystemGroup } from "../groups/repository";
import type { ResolvedRoute } from "./contract";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function routeParts(path: string): string[] | null {
  if (!path.startsWith("/") || path.startsWith("//") || /[?#\\]/.test(path)) return null;
  try {
    const parts = path.replace(/\/$/, "").split("/").slice(1).map(decodeURIComponent);
    return parts.some((part) => !part || /[/\\]/.test(part)) ? null : parts;
  } catch {
    return null;
  }
}

/** Resolves canonical and legacy destinations under the same visibility rules as reads. */
export async function resolveRoute(
  db: QueryDatabase,
  viewer: string | null,
  input: { path: string; group?: string },
): Promise<Result<ResolvedRoute, ApplicationError>> {
  const parts = routeParts(input.path);
  if (!parts) return err(notFound("Destination"));
  try {
    const [root, key, slug] = parts;
    if ((root === "u" || root === "people") && key && parts.length <= (root === "u" ? 3 : 2)) {
      const [owner] = await db
        .select({ id: user.id, username: user.username })
        .from(user)
        .where(
          root === "people"
            ? eq(user.id, key)
            : sql`${user.id} = (select ${usernameAliases.userId} from ${usernameAliases} where ${usernameAliases.username} = ${key.toLowerCase()})`,
        )
        .limit(1);
      if (!owner?.username) return err(notFound("Destination"));
      const collection = slug ?? input.group;
      if (!collection || collection === "all")
        return ok({
          kind: "profile",
          userId: owner.id,
          canonicalPath: profilePath(owner.username),
        });
      const findGroup = () =>
        db
          .select({ id: groups.id, slug: groups.slug })
          .from(groups)
          .where(
            and(
              eq(groups.ownerId, owner.id),
              groupVisible(viewer),
              uuid.test(collection) && !slug
                ? eq(groups.id, collection)
                : sql`${groups.id} = (select ${groupAliases.groupId} from ${groupAliases} where ${groupAliases.ownerId} = ${owner.id} and ${groupAliases.slug} = ${collection.toLowerCase()})`,
            ),
          )
          .limit(1);
      let [group] = await findGroup();
      if (
        !group &&
        viewer === owner.id &&
        (collection === "starred" || collection === "favorites")
      ) {
        const ensured = await ensureSystemGroup(db, owner.id, collection);
        if (ensured.isErr()) return err(ensured.error);
        [group] = await findGroup();
      }
      if (!group) return err(notFound("Destination"));
      return ok({
        kind: "group",
        userId: owner.id,
        groupId: group.id,
        canonicalPath: groupPath(owner.username, group.slug),
      });
    }
    if ((root === "l" || root === "links") && key && parts.length === 2) {
      const [link] = await db
        .select({ id: links.id, shortId: links.shortId })
        .from(links)
        .where(
          and(
            linkVisible(viewer),
            root === "links" && uuid.test(key) ? eq(links.id, key) : eq(links.shortId, key),
          ),
        )
        .limit(1);
      if (!link) return err(notFound("Destination"));
      return ok({ kind: "link", linkId: link.id, canonicalPath: linkPath(link.shortId) });
    }
    if (root === "messages" && key && parts.length === 2 && viewer) {
      const [chat] = await db
        .select({ id: conversations.id, shortId: conversations.shortId })
        .from(conversations)
        .innerJoin(
          conversationMembers,
          and(
            eq(conversationMembers.conversationId, conversations.id),
            eq(conversationMembers.userId, viewer),
          ),
        )
        .where(uuid.test(key) ? eq(conversations.id, key) : eq(conversations.shortId, key))
        .limit(1);
      if (!chat) return err(notFound("Destination"));
      return ok({
        kind: "conversation",
        conversationId: chat.id,
        canonicalPath: conversationPath(chat.shortId),
      });
    }
    return err(notFound("Destination"));
  } catch (cause) {
    return err(databaseError(cause));
  }
}
