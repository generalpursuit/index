import { useEffect, useEffectEvent, useState } from "react";
import { createPortal } from "react-dom";
import { Paperclip } from "lucide-react";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { maxBodyLength } from "@index/api/features/messages/schemas";
import type { useAPI } from "@/hooks/use-api";
import { linkReferencePath } from "@/lib/route-paths";
import type { MessageDraft } from "./draft";
import { droppedFiles, droppedText } from "./transfers";

type API = ReturnType<typeof useAPI>;
const accepted = new Set(["Files", "text/uri-list", "text/plain"]);
const textInputs = new Set(["text", "search", "url", "email", "tel", "password"]);

/**
 * While mounted, files, links and text dragged in from outside the page land in the open
 * conversation wherever they are dropped over it, and an overlay covers its pane meanwhile.
 * Dialogs and other layers over the conversation take no drops. Text fields take dropped text
 * themselves, where it lands. The page's own drags are left to the browser.
 */
export function ConversationDrop({
  name,
  onFiles,
  onText,
}: {
  /** Who the message goes to, as the overlay names them. */
  name: string;
  onFiles: (files: File[]) => void;
  onText: (text: string) => void;
}) {
  const offer = useWindowDrop((data) => {
    const files = droppedFiles(data),
      folders = data.files.length - files.length;
    if (folders) toast.error("Folders can’t be attached.");
    if (files.length) return onFiles(files);
    if (folders) return;
    // Some drags report files they don't give, as images from some pages do; their text counts.
    const text = droppedText(data);
    if (text) onText(text);
  });
  return offer ? <DropOverlay name={name} files={offer === "files"} /> : null;
}

/** What the overlay offers to add: files, or an address or text. */
type Offer = "files" | "text";
/**
 * Where a drag is:
 * - `browser`: the page's own drag, an unknown kind, text over a layer's text field, or a drag
 *   another handler has taken;
 * - `field`: text over a text field in the conversation, such as the composer;
 * - `layer`: dialogs, menus and toasts over the conversation, outside the app's own tree;
 * - `pane`: anywhere else, where the conversation receives it.
 */
type Place = "browser" | "field" | "layer" | "pane";

function placeOf(event: DragEvent, inside: boolean): Place {
  const types = Array.from(event.dataTransfer?.types ?? []);
  if (event.defaultPrevented || inside || !types.some((type) => accepted.has(type)))
    return "browser";
  const node = event.target as Node | null;
  const element = node instanceof Element ? node : (node?.parentElement ?? null);
  const layer =
    !element ||
    !element.closest("[data-app-root]") ||
    !!element.closest("[role=dialog], [role=alertdialog]");
  if (!types.includes("Files") && element && takesText(element)) return layer ? "browser" : "field";
  return layer ? "layer" : "pane";
}

/** Whether an element inserts dropped text itself, as enabled text fields do. */
function takesText(element: Element) {
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  const field =
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement && textInputs.has(element.type))
      ? element
      : null;
  return !!field && !field.disabled && !field.readOnly;
}

/** What the drag over the window offers; `receive` gets what is dropped on the conversation. */
function useWindowDrop(receive: (data: DataTransfer) => void) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const onDrop = useEffectEvent(receive);
  useEffect(() => {
    // The nodes a drag has entered and not yet left. Entering the next node comes before
    // leaving the last, so this is empty only once the drag has left the window.
    const entered = new Set<Node>();
    // What the node under the drag offers; nothing over layers and text fields.
    let under: Offer | null = null;
    // Set while the page's own content is dragged.
    let inside = false;
    // Browsers repeat `dragover` at least every 350 ms while a drag is over the page, so a
    // second without one means it has gone, even if its last `dragleave` never came.
    let silence: ReturnType<typeof setTimeout> | undefined;
    const show = () => {
      // A node removed while dragged over never reports being left.
      for (const node of entered) if (!node.isConnected) entered.delete(node);
      setOffer(entered.size ? under : null);
    };
    // Given the place as judged before this listener accepts the drag, which marks it handled.
    const look = (event: DragEvent, place: Place) => {
      under =
        place === "pane" ? (event.dataTransfer!.types.includes("Files") ? "files" : "text") : null;
      show();
    };
    const clear = () => {
      clearTimeout(silence);
      entered.clear();
      under = null;
      setOffer(null);
    };
    const listening = new AbortController(),
      options = { signal: listening.signal };
    // A drag that never reported its end can't hold this past the next press.
    window.addEventListener(
      "pointerdown",
      () => {
        inside = false;
      },
      options,
    );
    window.addEventListener(
      "dragstart",
      (event) => {
        inside = !event.defaultPrevented;
      },
      options,
    );
    window.addEventListener(
      "dragend",
      () => {
        inside = false;
        clear();
      },
      options,
    );
    window.addEventListener(
      "dragenter",
      (event) => {
        entered.add(event.target as Node);
        look(event, placeOf(event, inside));
      },
      options,
    );
    window.addEventListener(
      "dragleave",
      (event) => {
        entered.delete(event.target as Node);
        show();
      },
      options,
    );
    window.addEventListener(
      "dragover",
      (event) => {
        clearTimeout(silence);
        silence = setTimeout(clear, 1000);
        const place = placeOf(event, inside);
        if (place === "layer" || place === "pane") {
          // Accepting the drag is what lets it drop anywhere over the pane. Over a layer it is
          // accepted too, but as no operation, so the browser doesn't open a dropped file or
          // follow a dropped link instead.
          event.preventDefault();
          event.dataTransfer!.dropEffect = place === "pane" ? "copy" : "none";
        }
        look(event, place);
      },
      options,
    );
    window.addEventListener(
      "drop",
      (event) => {
        const place = placeOf(event, inside);
        inside = false;
        clear();
        if (place === "browser") return;
        const data = event.dataTransfer!;
        if (place === "field") {
          // The field inserts text where it lands; only an Index address may attach its post.
          const text = droppedText(data);
          if (!indexAddress(text)) return;
        }
        event.preventDefault();
        if (place !== "layer") onDrop(data);
      },
      options,
    );
    return () => {
      listening.abort();
      clearTimeout(silence);
    };
  }, []);
  return offer;
}

/**
 * Dropped text as an address in this app, which shares the page's origin. On desktop that origin
 * is the app's own, so Index addresses from a browser stay text there; they still open the post.
 */
function indexAddress(text: string) {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  // Addresses without an origin of their own, such as `data:` and `file:`, all report "null".
  return url.origin !== "null" && url.origin === location.origin ? url : null;
}

/** The post a dropped Index address shows, if the viewer can see it. */
async function droppedPost(text: string, api: API, cache: QueryClient) {
  const url = indexAddress(text);
  if (!url) return null;
  // A post opened over a page is addressed by its `post` parameter.
  const post = url.searchParams.get("post");
  const path = post ? linkReferencePath(post) : url.pathname;
  try {
    // A drop waits on these, so a failed lookup leaves the address as text at once.
    const route = await cache.fetchQuery({
      ...api.routes.resolve.queryOptions({ input: { path } }),
      retry: false,
    });
    if (route.kind !== "link") return null;
    return await cache.fetchQuery({
      ...api.links.get.queryOptions({ input: { id: route.linkId } }),
      retry: false,
    });
  } catch {
    return null;
  }
}

/** A dropped Index post is attached; any other address or text joins the message's text. */
export async function receiveDroppedText(
  owner: MessageDraft,
  text: string,
  api: API,
  cache: QueryClient,
) {
  const post = await droppedPost(text, api, cache);
  // During a send the post waits for the next message, as other attachments do.
  if (post) return owner.attach(post);
  const { status, body } = owner.getSnapshot();
  if (status === "sending" || status === "uncertain")
    return void toast.error("Send or discard this message first.");
  const trimmed = body.trimEnd();
  owner.editBody((trimmed ? trimmed + " " + text : text).slice(0, maxBodyLength));
}

/** Covers the conversation pane, beside the navigation rail, while something is dragged in. */
function DropOverlay({ name, files }: { name: string; files: boolean }) {
  const pane = document.getElementById("app-content");
  if (!pane) return null;
  return createPortal(
    <div
      className="drop-overlay pointer-events-none absolute z-10 inset-3 left-28 [@media(width<=700px)]:left-3 [@media(width<=700px)]:bottom-[calc(78px+env(safe-area-inset-bottom))] grid place-items-center rounded-[18px] border-[1.5px] border-dashed border-foreground/50 bg-background/60 backdrop-blur-[3px] text-center"
      aria-hidden="true"
    >
      <div>
        <span className="mx-auto mb-3 grid size-12.5 place-items-center rounded-full bg-muted">
          <Paperclip className="size-5.5" />
        </span>
        <strong className="block text-[16px] font-semibold">
          {files ? "Drop to attach" : "Drop to add to your message"}
        </strong>
        <small className="mt-1 block text-[12.5px] text-subtle-foreground">
          {files ? `Adds them to your message to ${name}` : `To ${name}`}
        </small>
      </div>
    </div>,
    pane,
  );
}
