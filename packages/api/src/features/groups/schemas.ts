import { z } from "zod";
import { pageInputSchema, userIdSchema, visibilitySchema } from "../../shared/schemas";

import { normalizeGroupName, groupSlug, reservedGroupSlugs } from "../../routes";

const nameSchema = z.string().transform(normalizeGroupName).pipe(z.string().min(1).max(100));
const customNameSchema = nameSchema.refine(
  (name) => !reservedGroupSlugs.has(groupSlug(name)),
  "This group name is reserved.",
);
export const groupSchema = z.object({
  id: z.uuid(),
  ownerId: userIdSchema,
  // Legacy names may expand under NFKC. Reads preserve the full repaired display name.
  name: z.string().min(1),
  slug: z.string().min(1),
  kind: z.enum(["custom", "starred", "favorites"]),
  visibility: visibilitySchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const createGroupSchema = z.strictObject({
  name: customNameSchema,
  visibility: visibilitySchema.default("public"),
});
export const updateGroupSchema = z
  .strictObject({
    id: z.uuid(),
    name: customNameSchema.optional(),
    visibility: visibilitySchema.optional(),
  })
  .refine(
    (input) => input.name !== undefined || input.visibility !== undefined,
    "Provide a change.",
  );
export const deleteGroupSchema = z.strictObject({
  id: z.uuid(),
  deleteLinks: z.boolean().default(false),
});
export const listGroupsSchema = pageInputSchema.extend({
  ownerId: userIdSchema.optional(),
});
export const groupPageSchema = z.object({
  /** Listed groups say how many of their links the viewer may see. */
  items: z.array(groupSchema.extend({ linkCount: z.number().int().nonnegative() })),
  nextCursor: z.string().nullable(),
});
export type CreateGroupInput = z.output<typeof createGroupSchema>;
export type UpdateGroupInput = z.output<typeof updateGroupSchema>;
