import { Link, useNavigate } from "@tanstack/react-router";
import { Input } from "@index/ui/components/input";
import { LockKeyhole, Search } from "lucide-react";
import { Heading, QueryState, UserAvatar, More } from "@/components/app/primitives";
import { useDiscovery } from "./hooks/use-discovery";
import { useDebounced } from "@/hooks/use-debounced";
import { useViewer } from "@/hooks/use-api";
import { FollowButton } from "@/features/profiles/profile-page";
import { FollowedBy } from "@/features/profiles/followed-by";
export function DiscoverPage({ query = "" }: { query?: string }) {
  const navigate = useNavigate(),
    search = useDebounced(query.trim()),
    { suggested, search: found } = useDiscovery(search),
    viewer = useViewer();
  const active = search ? found : suggested,
    people = search ? found.data?.pages.flatMap((p) => p.items) : suggested.data?.items;
  return (
    <div className="discover-page">
      <Heading>Discover</Heading>
      <label className="search-field">
        <Search size={18} />
        <Input
          aria-label="Search people"
          placeholder="Search people"
          value={query}
          onChange={(e) => {
            void navigate({
              to: "/discover",
              search: { q: e.target.value || undefined },
              replace: true,
              resetScroll: false,
            });
          }}
        />
      </label>
      <QueryState
        pending={active.isPending}
        hasData={!!active.data}
        error={active.error}
        retry={() => void active.refetch()}
      >
        <div className="people-list">
          {people
            ?.filter((p) => p.id !== viewer?.id)
            .map((p) => (
              <div className="person-row" key={p.id}>
                <Link
                  to="/u/$username"
                  params={{ username: p.username! }}
                  className="person-inline"
                >
                  <UserAvatar person={p} />
                  <span className="person-label">
                    <strong>
                      {p.name} {p.profileVisibility === "private" && <LockKeyhole size={13} />}
                    </strong>
                    <small>
                      @{p.username ?? p.name}
                      {p.followedBy.total > 0 && (
                        <>
                          {" · "}
                          <FollowedBy context={p.followedBy} />
                        </>
                      )}
                    </small>
                  </span>
                </Link>
                <FollowButton person={p} followingStatus={p.followingStatus} />
              </div>
            ))}
        </div>
        {people?.length === 0 && (
          <div className="empty-box">
            <p>{search ? "No one by that name" : "Search for someone you know"}</p>
          </div>
        )}
        {search && (
          <More
            hasNext={found.hasNextPage}
            isFetching={found.isFetchingNextPage}
            fetch={found.fetchNextPage}
          />
        )}
      </QueryState>
    </div>
  );
}
