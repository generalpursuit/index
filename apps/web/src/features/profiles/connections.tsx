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
      <div className="recipient-list">
        <QueryState pending={list.isPending} error={list.error} retry={() => void list.refetch()}>
          {list.data?.pages
            .flatMap((p) => p.items)
            .map((p) => (
              <div className="person-row" key={p.id}>
                <Link
                  to="/people/$userId"
                  params={{ userId: p.id }}
                  onClick={onClose}
                  className="person-inline"
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
            <p className="empty-state">
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
