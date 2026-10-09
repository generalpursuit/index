import { weekStartSchema } from "../../shared/weeks";
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

export const getLinkInputSchema = z.strictObject({ id: z.uuid() });

export const listMyLinksInputSchema = z.strictObject({
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
  weekStart: weekStartSchema.optional(),
  groupId: z.uuid().optional(),
  category: linkCategorySchema.optional(),
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
  groupId: z.uuid(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
  weekStart: weekStartSchema.optional(),
});

export const linkSchema = z.object({
  id: z.uuid(),
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

export type CreateLinkInput = z.output<typeof createLinkInputSchema>;
export type ListMyLinksInput = z.output<typeof listMyLinksInputSchema>;
export type Link = z.output<typeof linkSchema>;
export type UpdateLinkInput = z.output<typeof updateLinkInputSchema>;

export const listOwnerLinksSchema = listMyLinksInputSchema
  .omit({ groupId: true, category: true })
  .extend({ userId: z.string().min(1).max(128) });

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

export const previewLinkInputSchema = z.strictObject({ url: createLinkInputSchema.shape.url });
export const linkPreviewSchema = z.object({
  title: z.string(),
  siteName: z.string().nullable(),
  category: linkCategorySchema,
});
