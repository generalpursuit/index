import { z } from "zod";
import { linkSchema } from "../links/schemas";
import { publicUserSchema } from "../profiles/schemas";

export const feedPageSchema = z.object({
  items: z.array(linkSchema.extend({ author: publicUserSchema })),
  nextCursor: z.string().nullable(),
});
