import { z } from "zod";
import { baseContract, successSchema } from "../../shared/schemas";
import {
  alertSchema,
  capabilitiesSchema,
  deviceInput,
  preferencesSchema,
  registerSchema,
} from "./schemas";
const route = (method: "GET" | "POST" | "PATCH", path: string) =>
  baseContract.route({ method, path: `/me/notifications${path}`, tags: ["Notifications"] });
export const notificationsContract = {
  preferences: route("GET", "/preferences").input(z.strictObject({})).output(preferencesSchema),
  updatePreferences: route("PATCH", "/preferences")
    .input(preferencesSchema.partial())
    .output(preferencesSchema),
  capabilities: route("GET", "/capabilities").input(z.strictObject({})).output(capabilitiesSchema),
  register: route("POST", "/devices")
    .input(registerSchema)
    .output(z.object({ id: z.uuid() })),
  status: route("POST", "/devices/status")
    .input(deviceInput)
    .output(z.object({ registered: z.boolean() })),
  unregister: route("POST", "/devices/remove").input(deviceInput).output(successSchema),
  active: route("POST", "/active")
    .input(deviceInput.extend({ conversationId: z.uuid().nullable() }))
    .output(successSchema),
  poll: route("POST", "/poll")
    .input(deviceInput)
    .output(z.object({ items: z.array(z.object({ alert: alertSchema, lease: z.uuid() })) })),
  ack: route("POST", "/ack")
    .input(deviceInput.extend({ id: z.uuid(), lease: z.uuid() }))
    .output(successSchema),
  resolve: route("POST", "/resolve")
    .input(deviceInput.extend({ id: z.uuid(), opening: z.boolean().default(false) }))
    .output(alertSchema.nullable()),
};
