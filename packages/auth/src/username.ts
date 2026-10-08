import { z } from "zod";

// Free of server imports so browser contracts and sign-up forms can share the rule.
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, { message: "Use at least 3 characters.", abort: true })
  .max(30, "Use at most 30 characters.")
  .regex(/^[a-z0-9_]+$/, "Use only letters, numbers and underscores.");
