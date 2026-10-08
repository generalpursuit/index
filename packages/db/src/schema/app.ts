import { defineRelationsPart, inArray, sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { linkCategories } from "../categories";
import { user } from "./auth";

export { linkCategories } from "../categories";

export const groupVisibilities = ["private", "public"] as const;
export const groupKinds = ["custom", "starred"] as const;
export const followStatuses = ["pending", "accepted"] as const;

export const groups = pgTable(
  "groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", { enum: groupKinds }).default("custom").notNull(),
    visibility: text("visibility", { enum: groupVisibilities }).default("public").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("groups_owner_id_id_unique").on(table.ownerId, table.id),
    uniqueIndex("groups_one_starred_per_owner")
      .on(table.ownerId)
      .where(sql`${table.kind} = 'starred'`),
    check("groups_name_not_empty", sql`length(btrim(${table.name})) > 0`),
    check("groups_kind_check", inArray(table.kind, groupKinds)),
    check("groups_visibility_check", inArray(table.visibility, groupVisibilities)),
  ],
);

export const links = pgTable(
  "links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    groupId: uuid("group_id"),
    url: text("url").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category", { enum: linkCategories }).default("uncategorized").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "links_owner_group_fk",
      columns: [table.ownerId, table.groupId],
      foreignColumns: [groups.ownerId, groups.id],
    }),
    index("links_owner_created_at_id_idx").on(
      table.ownerId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index("links_group_created_at_id_idx").on(
      table.groupId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    check("links_url_not_empty", sql`length(btrim(${table.url})) > 0`),
    check("links_title_not_empty", sql`length(btrim(${table.title})) > 0`),
    check("links_category_check", inArray(table.category, linkCategories)),
  ],
);

export const follows = pgTable(
  "follows",
  {
    followerId: text("follower_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    followedId: text("followed_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status", { enum: followStatuses }).default("pending").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.followerId, table.followedId] }),
    index("follows_incoming_idx").on(
      table.followedId,
      table.status,
      table.createdAt.desc(),
      table.followerId,
    ),
    check("follows_no_self_follow", sql`${table.followerId} <> ${table.followedId}`),
    check("follows_status_check", inArray(table.status, followStatuses)),
    check(
      "follows_acceptance_check",
      sql`(${table.status} = 'accepted') = (${table.acceptedAt} IS NOT NULL)`,
    ),
  ],
);

export const stars = pgTable(
  "stars",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    linkId: uuid("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.linkId] }),
    index("stars_group_created_at_link_idx").on(
      table.groupId,
      table.createdAt.desc(),
      table.linkId,
    ),
    index("stars_link_id_idx").on(table.linkId),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    linkId: uuid("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("comments_link_created_at_id_idx").on(table.linkId, table.createdAt, table.id),
    index("comments_author_id_idx").on(table.authorId),
    check("comments_body_not_empty", sql`length(btrim(${table.body})) > 0`),
  ],
);

export const appRelations = defineRelationsPart(
  { user, groups, links, follows, stars, comments },
  (r) => ({
    user: {
      groups: r.many.groups({ from: r.user.id, to: r.groups.ownerId }),
      links: r.many.links({ from: r.user.id, to: r.links.ownerId }),
      following: r.many.follows({
        from: r.user.id,
        to: r.follows.followerId,
        where: { status: "accepted" },
      }),
      followers: r.many.follows({
        from: r.user.id,
        to: r.follows.followedId,
        where: { status: "accepted" },
      }),
      sentFollowRequests: r.many.follows({
        from: r.user.id,
        to: r.follows.followerId,
        where: { status: "pending" },
      }),
      receivedFollowRequests: r.many.follows({
        from: r.user.id,
        to: r.follows.followedId,
        where: { status: "pending" },
      }),
      starredGroup: r.one.groups({
        from: r.user.id,
        to: r.groups.ownerId,
        where: { kind: "starred" },
      }),
      comments: r.many.comments({ from: r.user.id, to: r.comments.authorId }),
    },
    groups: {
      owner: r.one.user({ from: r.groups.ownerId, to: r.user.id, optional: false }),
      links: r.many.links({
        from: [r.groups.ownerId, r.groups.id],
        to: [r.links.ownerId, r.links.groupId],
      }),
      stars: r.many.stars({ from: r.groups.id, to: r.stars.groupId }),
    },
    links: {
      owner: r.one.user({ from: r.links.ownerId, to: r.user.id, optional: false }),
      group: r.one.groups({
        from: [r.links.ownerId, r.links.groupId],
        to: [r.groups.ownerId, r.groups.id],
      }),
      stars: r.many.stars({ from: r.links.id, to: r.stars.linkId }),
      comments: r.many.comments({ from: r.links.id, to: r.comments.linkId }),
    },
    follows: {
      follower: r.one.user({ from: r.follows.followerId, to: r.user.id, optional: false }),
      followed: r.one.user({ from: r.follows.followedId, to: r.user.id, optional: false }),
    },
    stars: {
      group: r.one.groups({ from: r.stars.groupId, to: r.groups.id, optional: false }),
      link: r.one.links({ from: r.stars.linkId, to: r.links.id, optional: false }),
    },
    comments: {
      link: r.one.links({ from: r.comments.linkId, to: r.links.id, optional: false }),
      author: r.one.user({ from: r.comments.authorId, to: r.user.id, optional: false }),
    },
  }),
);
