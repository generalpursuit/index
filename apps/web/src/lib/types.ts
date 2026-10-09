import type { AppRouterClient } from "@index/api/contracts";
export type SavedLink = Awaited<ReturnType<AppRouterClient["links"]["get"]>>;
export type Profile = Awaited<ReturnType<AppRouterClient["profiles"]["get"]>>;
export type Person = Pick<Profile, "id" | "name" | "username" | "image" | "profileVisibility">;
export type Group = Awaited<ReturnType<AppRouterClient["groups"]["get"]>>;
export type Conversation = Awaited<ReturnType<AppRouterClient["messages"]["conversation"]>>;
export type Message = Awaited<ReturnType<AppRouterClient["messages"]["send"]>>;
