import { implement, ORPCError } from "@orpc/server";
import { and, eq, sql } from "drizzle-orm";
import { user, usernameAliases } from "@index/db/schema/auth";
import {
  groups,
  groupAliases,
  links,
  conversations,
  conversationMembers,
} from "@index/db/schema/app";
import type { Context } from "../../context";
import { groupVisible, linkVisible } from "../../data-access/visibility";
import { conversationPath, groupPath, linkPath, profilePath } from "../../routes";
import { ensureSystemGroup } from "../groups/repository";
import { unwrapResult } from "../../procedures";
import { routesContract, type ResolvedRoute } from "./contract";
const missing = () => new ORPCError("NOT_FOUND", { message: "Destination not found." });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const api = implement(routesContract).$context<Context>();
export const routesRouter = api.router({
  resolve: api.resolve.handler(async ({ context, input }): Promise<ResolvedRoute> => {
    const db = context.db,
      viewer = context.session?.user.id ?? null;
    let parts: string[];
    try {
      if (!input.path.startsWith("/") || input.path.startsWith("//") || /[?#\\]/.test(input.path))
        throw missing();
      parts = input.path.replace(/\/$/, "").split("/").slice(1).map(decodeURIComponent);
      if (parts.some((p) => !p || /[/\\]/.test(p))) throw missing();
    } catch {
      throw missing();
    }
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
      if (!owner?.username) throw missing();
      const collection = slug ?? input.group;
      if (!collection || collection === "all")
        return { kind: "profile", userId: owner.id, canonicalPath: profilePath(owner.username) };
      if (viewer === owner.id && (collection === "starred" || collection === "favorites"))
        unwrapResult(await ensureSystemGroup(db, owner.id, collection));
      const [group] = await db
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
      if (!group) throw missing();
      return {
        kind: "group",
        userId: owner.id,
        groupId: group.id,
        canonicalPath: groupPath(owner.username, group.slug),
      };
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
      if (!link) throw missing();
      return { kind: "link", linkId: link.id, canonicalPath: linkPath(link.shortId) };
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
      if (!chat) throw missing();
      return {
        kind: "conversation",
        conversationId: chat.id,
        canonicalPath: conversationPath(chat.shortId),
      };
    }
    throw missing();
  }),
});
