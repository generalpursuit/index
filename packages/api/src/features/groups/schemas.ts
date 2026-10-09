import { z } from "zod";
import { pageInputSchema, userIdSchema, visibilitySchema } from "../../shared/schemas";

const nameSchema = z.string().trim().min(1).max(100);
const customNameSchema = nameSchema.refine(
  (name) => !["all", "starred", "favorites"].includes(name.toLowerCase()),
  "This group name is reserved.",
);
export const groupSchema = z.object({
  id: z.uuid(),
  ownerId: userIdSchema,
  name: nameSchema,
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
  items: z.array(groupSchema),
  nextCursor: z.string().nullable(),
});
export type CreateGroupInput = z.output<typeof createGroupSchema>;
export type UpdateGroupInput = z.output<typeof updateGroupSchema>;
