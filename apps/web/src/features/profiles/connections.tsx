import { PeoplePlaceholder, PersonRow } from "@/components/app/person-row";
import { useState } from "react";
import { Button } from "@index/ui/components/button";
import { Tabs, TabsList, TabsTrigger } from "@index/ui/components/tabs";
import { Modal } from "@index/ui/components/modal";
import { More, QueryState } from "@/components/app/query-state";
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
      fixedHeight
    >
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList variant="line">
          <TabsTrigger value="followers">Followers</TabsTrigger>
          <TabsTrigger value="following">Following</TabsTrigger>
        </TabsList>
      </Tabs>
      <div
        className={
          "recipient-list min-h-0 flex-1 overflow-y-auto overscroll-contain [&_.recipient-row]:flex [&_.recipient-row]:h-auto [&_.recipient-row]:justify-start [&_.recipient-row]:cursor-pointer [&_.recipient-row]:w-full [&_.recipient-row]:items-center [&_.recipient-row]:gap-3 [&_.recipient-row]:p-3 [&_.recipient-row]:rounded-[12px] [&_.recipient-row]:text-left"
        }
      >
        <QueryState
          placeholder={<PeoplePlaceholder />}
          pending={list.isPending}
          hasData={!!list.data}
          error={list.error}
          retry={() => void list.refetch()}
        >
          {list.data?.pages
            .flatMap((p) => p.items)
            .map((p) => (
              <PersonRow
                person={p}
                onOpen={onClose}
                key={p.id}
                action={
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
                }
              >
                <span>{p.username ?? p.name}</span>
              </PersonRow>
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
