import { Link, useNavigate } from "@tanstack/react-router";
import { Input } from "@index/ui/components/input";
import { LockKeyhole, Search } from "lucide-react";
import { Heading, QueryState, UserAvatar, More } from "@/components/app/primitives";
import { useDiscovery } from "./hooks/use-discovery";
import { useDebounced } from "@/hooks/use-debounced";
import { useViewer } from "@/hooks/use-api";
import { FollowButton } from "@/features/profiles/profile-page";
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
        <Search size={19} />
        <Input
          aria-label="Search people"
          placeholder="Search"
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
        error={active.error}
        retry={() => void active.refetch()}
      >
        <div className="people-list">
          {people
            ?.filter((p) => p.id !== viewer?.id)
            .map((p) => (
              <div className="person-row" key={p.id}>
                <Link to="/people/$userId" params={{ userId: p.id }} className="person-inline">
                  <UserAvatar person={p} />
                  <span className="person-label">
                    <strong>
                      {p.name} {p.profileVisibility === "private" && <LockKeyhole size={13} />}
                    </strong>
                    <small>
                      @{p.username ?? p.name}
                      {"mutualCount" in p && typeof p.mutualCount === "number"
                        ? " · Followed by " + p.mutualCount + " people you follow"
                        : ""}
                    </small>
                  </span>
                </Link>
                <FollowButton person={p} />
              </div>
            ))}
        </div>
        {people?.length === 0 && (
          <p className="empty-state">
            {search ? "No people found." : "Search for someone to follow."}
          </p>
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
