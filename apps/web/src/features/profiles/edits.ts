import type { QueryKey } from "@tanstack/react-query";
import { mapItems } from "@/data/edits";

/** Incoming requests and your outgoing follow are separate relationships. */
export function patchRelationship(
  userId: string,
  status: "pending" | "accepted" | null,
  requestStatus?: string,
  hiddenPosts?: ReadonlySet<string>,
) {
  return (data: unknown, key: QueryKey) => {
    const path = key[0] as string[];
    const hideContent = !!hiddenPosts;
    const input = (
      key[1] as { input?: { userId?: string; ownerId?: string; linkId?: string } } | undefined
    )?.input;
    if (
      hideContent &&
      ((path[2] === "links" && input?.userId === userId) ||
        (path[2] === "groups" && input?.ownerId === userId) ||
        (path[2] === "comments" && !!input?.linkId && hiddenPosts?.has(input.linkId)))
    )
      return undefined;
    const removing =
      !requestStatus && status === null && path[2] === "follows" && path[3] === "following";
    const requestList = !!requestStatus && path[2] === "follows" && path[3] === "requests";
    return mapItems(
      data,
      (item) =>
        ((!requestStatus || requestList) && item.id === userId && "name" in item) ||
        (!!requestStatus &&
          (item.actor as { id?: string } | undefined)?.id === userId &&
          item.type === "request") ||
        (hideContent && item.ownerId === userId && ("url" in item || "slug" in item)),
      (item) =>
        hideContent && item.ownerId === userId
          ? undefined
          : item.type === "request"
            ? { ...item, requestStatus }
            : removing || requestList
              ? undefined
              : {
                  ...item,
                  ...("followingStatus" in item
                    ? {
                        followingStatus: status,
                        ...(status === null && item.profileVisibility === "private"
                          ? { canViewContent: false }
                          : {}),
                      }
                    : {}),
                },
    );
  };
}
