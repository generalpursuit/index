import { PersonRow, PeoplePlaceholder } from "@/components/app/person-row";
import { useNavigate } from "@tanstack/react-router";
import { Input } from "@index/ui/components/input";
import { LockKeyhole, Search } from "lucide-react";
import { Heading } from "@/components/app/navigation";
import { QueryState, More } from "@/components/app/query-state";
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
  const people = search
    ? (found.data?.pages.flatMap((p) => p.items) ?? suggested.data?.items)
    : suggested.data?.items;
  const active = search && found.data ? found : suggested;
  return (
    <div
      className={
        "discover-page [&>.page-heading_h1]:font-serif [&>.page-heading_h1]:font-bold [&>.page-heading_h1]:[font-variation-settings:'opsz'_60] [&>.page-heading_h1]:tracking-[-0.015em] [&>.page-heading_h1]:leading-[1] [&>.page-heading_h1]:text-[clamp(44px,_5vw,_62px)] [@media(width<=700px)_and_(height<=740px)]:[&>.page-heading_h1]:text-[36px]"
      }
    >
      <Heading>Discover</Heading>
      <label
        className={
          "search-field grid grid-cols-[18px_minmax(0,_1fr)] items-center gap-x-3.75 h-11 p-[0_14px] m-[0_0_20px] border border-border rounded-[10px] text-subtle-foreground [transition:border-color_150ms_ease] [&:focus-within]:border-input [&_svg]:[transition:color_150ms_ease] [&:hover_svg]:text-foreground [&:focus-within_svg]:text-foreground [&_input]:border-0 [&_input]:bg-transparent! [&_input]:[box-shadow:none]! [&_input]:rounded-none [&_input]:p-0 [&_input]:h-10.5 [&_input]:text-foreground [&_input]:text-[14px] [&_input]:min-w-0 [&_input::placeholder]:text-subtle-foreground [@media(width<=700px)]:[&_input]:text-[16px]"
        }
      >
        <Search size={18} />
        <Input
          variant="plain"
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
        placeholder={<PeoplePlaceholder />}
        pending={active.isPending}
        hasData={!!active.data}
        error={active.error}
        retry={() => void active.refetch()}
      >
        <div className="people-list">
          {people
            ?.filter((p) => p.id !== viewer?.id)
            .map((p) => (
              <PersonRow
                key={p.id}
                person={p}
                action={<FollowButton person={p} followingStatus={p.followingStatus} />}
              >
                <span
                  className={
                    "person-label [&_small]:text-subtle-foreground [&_small]:leading-[16px] [&_small]:text-[12px] [&_small]:overflow-hidden [&_small]:text-ellipsis [&_small]:whitespace-nowrap [&_strong]:font-medium [&_strong]:leading-[18px] [&_strong]:overflow-hidden [&_strong]:text-ellipsis flex flex-col min-w-0 gap-px [&_strong_svg]:inline [&_strong_svg]:align-middle"
                  }
                >
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
              </PersonRow>
            ))}
        </div>
        {people?.length === 0 && (
          <div
            className={
              "empty-box flex flex-col justify-center items-center gap-3 min-h-40 p-6 text-subtle-foreground text-center [&_a]:text-foreground [&_a:hover]:underline [&_a:hover]:underline-offset-[4px]"
            }
          >
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
