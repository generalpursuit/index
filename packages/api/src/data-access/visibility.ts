import { groups, links } from "@index/db/schema/app";
import { sql, type SQLWrapper } from "drizzle-orm";

// Basic profile identity stays discoverable. This predicate protects its content and social graph.
export function profileContentVisible(viewerId: string | SQLWrapper | null, ownerId: SQLWrapper) {
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

export function groupVisible(viewerId: string | SQLWrapper | null) {
  return sql<boolean>`(${groups.ownerId} = ${viewerId} or (
    ${groups.kind} <> 'starred' and ${groups.visibility} = 'public' and ${profileContentVisible(viewerId, groups.ownerId)}
  ))`;
}

// A link follows its owner's profile unless it sits in a locked group.
export function linkVisible(viewerId: string | SQLWrapper | null) {
  return sql<boolean>`(${links.ownerId} = ${viewerId} or (
    ${profileContentVisible(viewerId, links.ownerId)} and not ${linkLocked()}
  ))`;
}

export function linkLocked() {
  return sql<boolean>`exists (
    select 1 from groups as lock_group
    where lock_group.id = ${links.groupId} and lock_group.visibility = 'private'
  )`;
}
