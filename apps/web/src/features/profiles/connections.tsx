import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@index/ui/components/button";
import { Tabs, TabsList, TabsTrigger } from "@index/ui/components/tabs";
import { Modal, More, QueryState, UserAvatar } from "@/components/app/primitives";
import { useViewer } from "@/hooks/use-api";
import { useConnections, useProfileActions } from "./hooks/use-profiles";
export function Connections({
  initial,
  onClose,
}: {
  initial: "followers" | "following";
  onClose: () => void;
}) {
  const [tab, setTab] = useState(initial),
    viewer = useViewer()!,
    list = useConnections(viewer.id, tab),
    actions = useProfileActions();
  return (
    <Modal
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title="Connections"
    >
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList variant="line">
          <TabsTrigger value="followers">Followers</TabsTrigger>
          <TabsTrigger value="following">Following</TabsTrigger>
        </TabsList>
      </Tabs>
      <div
        className={
          "recipient-list max-h-[35dvh] overflow-auto [&_.recipient-row]:flex [&_.recipient-row]:h-auto [&_.recipient-row]:justify-start [&_.recipient-row]:cursor-pointer [&_.recipient-row]:w-full [&_.recipient-row]:items-center [&_.recipient-row]:gap-3 [&_.recipient-row]:p-3 [&_.recipient-row]:rounded-[12px] [&_.recipient-row]:text-left"
        }
      >
        <QueryState
          pending={list.isPending}
          hasData={!!list.data}
          error={list.error}
          retry={() => void list.refetch()}
        >
          {list.data?.pages
            .flatMap((p) => p.items)
            .map((p) => (
              <div
                className={
                  "person-row flex items-center justify-between gap-4 p-[13px_0] [&>.person-inline]:flex-1 [&_.person-label]:max-w-full [&>button]:shrink-0 [@media(width<=700px)]:gap-2.5 [@media(width<=700px)]:[&_.person-label_small]:max-w-45"
                }
                key={p.id}
              >
                <Link
                  to="/people/$userId"
                  params={{ userId: p.id }}
                  onClick={onClose}
                  className={"person-inline flex items-center gap-3 min-w-0 [&_strong]:font-medium"}
                >
                  <UserAvatar person={p} />
                  <span>{p.username ?? p.name}</span>
                </Link>
                <Button
                  variant="outline"
                  disabled={actions.removeFollower.isPending || actions.unfollow.isPending}
                  onClick={() =>
                    tab === "followers"
                      ? actions.removeFollower.mutate({ userId: p.id })
                      : actions.unfollow.mutate({ userId: p.id })
                  }
                >
                  {tab === "followers" ? "Remove" : "Unfollow"}
                </Button>
              </div>
            ))}
          {list.data?.pages[0]?.items.length === 0 && (
            <p
              className={
                "empty-state [&[role='alert']>p]:select-text text-muted-foreground p-[32px_12px] text-center [&_p]:mb-3.5 [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-[4px]"
              }
            >
              {tab === "followers" ? "No followers yet." : "You’re not following anyone yet."}
            </p>
          )}
          <More
            hasNext={list.hasNextPage}
            isFetching={list.isFetchingNextPage}
            fetch={list.fetchNextPage}
          />
        </QueryState>
      </div>
    </Modal>
  );
}
