import { groups, links } from "@index/db/schema/app";
import { sql, type SQLWrapper } from "drizzle-orm";

// Basic profile identity stays discoverable. This predicate protects its content and social graph.
export function profileContentVisible(viewerId: string | null, ownerId: SQLWrapper) {
  return sql<boolean>`exists (
    select 1 from "user" as access_owner
    where access_owner.id = ${ownerId} and (
      access_owner.id = ${viewerId} or access_owner.profile_visibility = 'public' or exists (
        select 1 from follows as access_follow
        where access_follow.follower_id = ${viewerId}
          and access_follow.followed_id = access_owner.id and access_follow.status = 'accepted'
      )
    )
  )`;
}

export function groupVisible(viewerId: string | null) {
  return sql<boolean>`(${groups.ownerId} = ${viewerId} or (
    ${groups.visibility} = 'public' and ${profileContentVisible(viewerId, groups.ownerId)}
  ))`;
}

export function linkVisible(viewerId: string | null) {
  return sql<boolean>`(${links.ownerId} = ${viewerId} or exists (
    select 1 from groups as access_group
    where access_group.id = ${links.groupId} and access_group.owner_id = ${links.ownerId}
      and access_group.kind = 'custom' and access_group.visibility = 'public'
      and ${profileContentVisible(viewerId, links.ownerId)}
  ))`;
}
