export type Pulse = {
  messages: { unreadCount: number; version: string };
  activity: { unreadCount: number; version: string };
};

/** One visible-window clock; overlapping focus, notifications and ticks share the in-flight read. */
export function createPulseDriver({
  request,
  visible,
  focusedConversation,
  changed,
}: {
  request: () => Promise<Pulse>;
  visible: () => boolean;
  focusedConversation: () => boolean;
  changed: (pulse: Pulse, messages: boolean, activity: boolean) => Promise<unknown> | void;
}) {
  let previous: Pulse | undefined,
    running: Promise<void> | undefined,
    stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(() => void tick(), focusedConversation() ? 3000 : 15_000);
  };
  function tick(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (running) return running;
    if (!visible()) {
      schedule();
      return Promise.resolve();
    }
    running = (async () => {
      try {
        const pulse = await request();
        if (stopped) return;
        await changed(
          pulse,
          pulse.messages.version !== previous?.messages.version,
          pulse.activity.version !== previous?.activity.version,
        );
        previous = pulse;
      } catch {
        /* A failed pulse retains readable content and tries again on the next tick. */
      } finally {
        running = undefined;
        schedule();
      }
    })();
    return running;
  }
  return {
    tick,
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

/** Refresh the newest page and keep older loaded history, removing overlap at the boundary. */
export function mergeNewestPage<
  T extends { id: string; createdAt?: string; updatedAt?: string },
  P extends { items: T[]; nextCursor: string | null },
>(current: { pages: P[]; pageParams: (string | undefined)[] } | undefined, newest: P) {
  if (!current) return { pages: [newest], pageParams: [undefined] };
  if (!newest.nextCursor) return { pages: [newest], pageParams: [undefined] };
  const ids = new Set(newest.items.map((item) => item.id));
  // Without overlap the old cursor skips an unknown number of arrivals. Start a
  // contiguous history at the new cursor; load more can recover every missing item.
  if (!current.pages[0]?.items.some((item) => ids.has(item.id)))
    return { pages: [newest], pageParams: [undefined] };
  const oldest = newest.items.at(-1);
  const boundary = oldest?.updatedAt ?? oldest?.createdAt;
  const tail =
    current.pages[0]?.items.filter((item) => {
      const at = item.updatedAt ?? item.createdAt ?? "";
      return (
        !ids.has(item.id) &&
        (!boundary || at < boundary || (at === boundary && item.id < oldest!.id))
      );
    }) ?? [];
  return {
    ...current,
    pages: [
      {
        ...newest,
        items: [...newest.items, ...tail],
        nextCursor: tail.length ? current.pages[0]!.nextCursor : newest.nextCursor,
      },
      ...current.pages
        .slice(1)
        .map((page) => ({ ...page, items: page.items.filter((item) => !ids.has(item.id)) })),
    ],
  };
}
