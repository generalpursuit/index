import type { Conversation, Message, Profile, SavedLink } from "@/lib/types";
import { monday } from "@/lib/weeks";

export const placeholderProfile: Profile = {
  id: "",
  name: "Someone",
  username: "username",
  image: null,
  profileVisibility: "public",
  canViewContent: true,
  followerCount: null,
  followingCount: null,
  linkCount: null,
  followedBy: { users: [], total: 0 },
  followingStatus: null,
};
export const placeholderLink: SavedLink = {
  id: "",
  shortId: "",
  ownerId: "",
  groupId: null,
  url: "https://example.com",
  title: "A saved link",
  description: null,
  category: "uncategorized",
  isFavorite: false,
  isStarred: false,
  savedOn: monday(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
export const placeholderConversation: Conversation = {
  id: "",
  shortId: "",
  participants: [placeholderProfile],
  canSend: false,
  unreadCount: 0,
  readReceiptMessageId: null,
  lastMessage: null,
  updatedAt: new Date().toISOString(),
};
export const placeholderMessages: Message[] = [0, 1, 2].map((index) => ({
  id: `placeholder-${index}`,
  conversationId: "",
  clientId: "",
  senderId: "",
  body: "A message in this conversation",
  createdAt: new Date().toISOString(),
  attachment: null,
  hasAttachment: false,
  restrictedAuthor: null,
  replyTo: null,
  files: [],
}));
