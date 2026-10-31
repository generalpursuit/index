type Socket = Pick<WebSocket, "send" | "close" | "readyState" | "addEventListener">;
let conversation: string | null = null;
let publishPresence: (() => void) | undefined;
export function setLiveConversation(value: string | null) {
  conversation = value;
  publishPresence?.();
}

/** Transport hints only. API reads still own authorization and the pulse owns reconciliation. */
export function connectLive({
  ticket,
  changed,
  revalidate,
  open = (url) => new WebSocket(url),
}: {
  ticket: () => Promise<{ url: string }>;
  changed: () => void;
  revalidate: () => Promise<unknown>;
  open?: (url: string) => Socket;
}) {
  let socket: Socket | undefined,
    stopped = false,
    connecting = false,
    failures = 0;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  function presence() {
    if (socket?.readyState !== 1) return;
    const active = !document.hidden && document.hasFocus() ? conversation : null;
    socket.send(active ? JSON.stringify({ type: "presence", conversationId: active }) : "ping");
  }
  const publish = () => {
    if (socket?.readyState === 1)
      socket.send(
        JSON.stringify({
          type: "presence",
          conversationId: !document.hidden && document.hasFocus() ? conversation : null,
        }),
      );
  };
  publishPresence = publish;
  async function connect() {
    if (stopped || connecting || (socket && socket.readyState < 2)) return;
    connecting = true;
    try {
      const result = await ticket();
      if (stopped) return;
      const current = open(result.url);
      socket = current;
      current.addEventListener("open", () => {
        if (stopped || socket !== current) return;
        failures = 0;
        publish();
        clearInterval(heartbeat);
        heartbeat = setInterval(presence, 30_000); // Edge-only keepalive; no API requests.
      });
      current.addEventListener("message", (event) => {
        if (stopped || socket !== current) return;
        if ((event as MessageEvent).data === '{"type":"change"}') changed();
      });
      current.addEventListener("close", (event) => {
        if (stopped || socket !== current) return;
        socket = undefined;
        clearInterval(heartbeat);
        if ((event as CloseEvent).code === 4001) {
          void revalidate()
            .catch(() => {})
            .finally(() => {
              if (!stopped) schedule();
            });
        } else schedule();
      });
      current.addEventListener("error", () => current.close());
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        [401, 403, 404, 501].includes(Number(error.status))
      )
        return;
      schedule();
    } finally {
      connecting = false;
    }
  }
  function schedule() {
    clearTimeout(reconnect);
    if (stopped) return;
    reconnect = setTimeout(
      () => void connect(),
      Math.min(900_000, 2000 * 2 ** Math.min(failures++, 10)) * (0.8 + Math.random() * 0.4),
    );
  }
  const focus = () => {
    publish();
    if (!document.hidden) {
      clearTimeout(reconnect);
      void connect();
    }
  };
  window.addEventListener("focus", focus);
  window.addEventListener("blur", focus);
  document.addEventListener("visibilitychange", focus);
  void connect();
  return () => {
    stopped = true;
    clearTimeout(reconnect);
    clearInterval(heartbeat);
    if (publishPresence === publish) publishPresence = undefined;
    socket?.close(1000);
    window.removeEventListener("focus", focus);
    window.removeEventListener("blur", focus);
    document.removeEventListener("visibilitychange", focus);
  };
}
