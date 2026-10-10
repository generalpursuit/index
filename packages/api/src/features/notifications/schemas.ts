import { z } from "zod";
export const preferencesSchema = z.strictObject({
  message: z.boolean(),
  comment: z.boolean(),
  mention: z.boolean(),
  request: z.boolean(),
  follow: z.boolean(),
  accepted: z.boolean(),
  previews: z.boolean(),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences: Preferences = {
  message: true,
  comment: true,
  mention: true,
  request: true,
  follow: true,
  accepted: true,
  previews: false,
};
export const installationSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const deviceInput = z.strictObject({
  installation: installationSchema,
  sessionId: z.string().min(1).max(256),
});
export const registerSchema = z.discriminatedUnion("kind", [
  deviceInput.extend({
    kind: z.literal("web"),
    endpoint: z.url().max(4096),
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
  deviceInput.extend({
    kind: z.literal("apns"),
    token: z.string().regex(/^[a-f0-9]{64,200}$/),
    environment: z.enum(["sandbox", "production"]),
  }),
  deviceInput.extend({ kind: z.literal("desktop") }),
]);
export type Registration = z.infer<typeof registerSchema>;
export const alertSchema = z.object({
  id: z.uuid(),
  recipientId: z.string(),
  title: z.string(),
  body: z.string(),
  path: z.string(),
  conversationId: z.string().nullable(),
});
export type Alert = z.infer<typeof alertSchema>;
export const capabilitiesSchema = z.object({
  web: z.boolean(),
  apns: z.boolean(),
  apnsEnvironment: z.enum(["sandbox", "production"]).nullable(),
  desktop: z.boolean(),
  sessionId: z.string(),
  vapidPublicKey: z.string().nullable(),
});
export type NotificationCapabilities = z.infer<typeof capabilitiesSchema>;
