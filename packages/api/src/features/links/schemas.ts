import { linkCategories } from "@index/db/categories";
import { z } from "zod";

export const linkCategorySchema = z.enum(linkCategories);

export const createLinkInputSchema = z.strictObject({
  url: z
    .url({ protocol: /^https?$/ })
    .trim()
    .max(8192),
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(10_000).nullable().optional(),
  category: linkCategorySchema.default("uncategorized"),
});

export const getLinkInputSchema = z.strictObject({ id: z.uuid() });

export const listMyLinksInputSchema = z.strictObject({
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
});

export const linkSchema = z.object({
  id: z.uuid(),
  ownerId: z.string().min(1),
  groupId: z.uuid().nullable(),
  url: z.url({ protocol: /^https?$/ }),
  title: z.string(),
  description: z.string().nullable(),
  category: linkCategorySchema,
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
