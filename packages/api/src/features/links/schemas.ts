import { weekStartSchema } from "../../shared/weeks";
import { pageCursorSchema, pageLimitSchema, userIdSchema } from "../../shared/schemas";
import { linkCategories } from "@index/db/categories";
import { z } from "zod";

export const linkCategorySchema = z.enum(linkCategories);

export const createLinkInputSchema = z.strictObject({
  url: z
    .url({ protocol: /^https?$/ })
    .trim()
    .max(8192),
  // Omitted titles are read from the page.
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().trim().max(10_000).nullable().optional(),
  groupId: z.uuid().nullable().optional(),
});

export const getLinkInputSchema = z.strictObject({
  id: z.uuid().describe("The link's ID, as returned by a list, search or resolved Index URL."),
});

const weekFilterSchema = weekStartSchema
  .optional()
  .describe(
    "Only links saved in the UTC week starting on this Monday (YYYY-MM-DD). Omit for all weeks.",
  );

export const listMyLinksInputSchema = z.strictObject({
  limit: pageLimitSchema,
  cursor: pageCursorSchema,
  weekStart: weekFilterSchema,
  groupId: z
    .uuid()
    .optional()
    .describe("Only links in this group of yours. Omit for links in any group or none."),
  category: linkCategorySchema
    .optional()
    .describe("Only links of this kind, as Index classified the page. Omit for every kind."),
});

export const updateLinkInputSchema = z
  .strictObject({
    id: z.uuid(),
    url: createLinkInputSchema.shape.url.optional(),
    title: createLinkInputSchema.shape.title.optional(),
    description: createLinkInputSchema.shape.description,
    groupId: z.uuid().nullable().optional(),
  })
  .refine(
    (input) => Object.entries(input).some(([key, value]) => key !== "id" && value !== undefined),
    "Provide a change.",
  );

export const listGroupLinksInputSchema = z.strictObject({
  groupId: z.uuid().describe("The group's ID, for example from resolving its Index address."),
  limit: pageLimitSchema,
  cursor: pageCursorSchema,
  weekStart: weekFilterSchema,
});

export const linkSchema = z.object({
  id: z.uuid(),
  shortId: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  ownerId: z.string().min(1),
  groupId: z.uuid().nullable(),
  url: z.url({ protocol: /^https?$/ }),
  title: z.string(),
  description: z.string().nullable(),
  category: linkCategorySchema,
  isFavorite: z.boolean().default(false),
  isStarred: z.boolean().default(false),
  savedOn: z.iso.date(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const listMyLinksOutputSchema = z.object({
  items: z.array(linkSchema),
  nextCursor: z.string().nullable(),
});
/** A group's links say whose they are: Starred holds other people's. */
export const listGroupLinksOutputSchema = z.object({
  items: z.array(linkSchema.extend({ ownerName: z.string() })),
  nextCursor: z.string().nullable(),
});

export type CreateLinkInput = z.output<typeof createLinkInputSchema>;
export type ListMyLinksInput = z.output<typeof listMyLinksInputSchema>;
export type Link = z.output<typeof linkSchema>;
export type UpdateLinkInput = z.output<typeof updateLinkInputSchema>;

export const listOwnerLinksSchema = listMyLinksInputSchema
  .omit({ groupId: true, category: true })
  .extend({ userId: userIdSchema.describe("The person's user ID, the `id` of their profile.") });

export const libraryWeeksInputSchema = z.strictObject({
  userId: z.string().min(1).max(128),
  groupId: z.uuid().optional(),
  before: weekStartSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
export const libraryWeeksSchema = z.object({
  items: z.array(z.object({ weekStart: weekStartSchema, count: z.number().int().positive() })),
  nextBefore: weekStartSchema.nullable(),
});
