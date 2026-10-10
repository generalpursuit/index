import { Fragment } from "react";
import { Link } from "@tanstack/react-router";
import type { Profile } from "@/lib/types";

/**
 * "Followed by lena", "Followed by lena and amir" or "Followed by lena and 2 others": people
 * you follow who follow this person too. Names link to them unless the text sits in a link.
 */
export function FollowedBy({
  context,
  linked = false,
}: {
  context: Profile["followedBy"];
  linked?: boolean;
}) {
  const shown = context.users.slice(0, context.total > 2 ? 1 : 2);
  return (
    <>
      Followed by{" "}
      {shown.map((person, i) => (
        <Fragment key={person.id}>
          {i > 0 && " and "}
          {linked ? (
            <Link to="/u/$username" params={{ username: person.username! }}>
              {person.username ?? person.name}
            </Link>
          ) : (
            (person.username ?? person.name)
          )}
        </Fragment>
      ))}
      {context.total > 2 && ` and ${context.total - 1} others`}
    </>
  );
}
