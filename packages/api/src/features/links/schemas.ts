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
  groupId: z.uuid().nullable().optional(),
});

export const getLinkInputSchema = z.strictObject({ id: z.uuid() });

export const listMyLinksInputSchema = z.strictObject({
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
  groupId: z.uuid().optional(),
  inbox: z.boolean().optional(),
  category: linkCategorySchema.optional(),
});

export const updateLinkInputSchema = z
  .strictObject({
    id: z.uuid(),
    url: createLinkInputSchema.shape.url.optional(),
    title: createLinkInputSchema.shape.title.optional(),
    description: createLinkInputSchema.shape.description,
    category: linkCategorySchema.optional(),
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
export type UpdateLinkInput = z.output<typeof updateLinkInputSchema>;
