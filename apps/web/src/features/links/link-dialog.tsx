import { useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Modal, ModalViews, type ModalView } from "@index/ui/components/modal";
import { LinkReference } from "@/features/routes/link-reference";
import { SendLink } from "@/features/messages/recipient-picker";
import type { SavedLink } from "@/lib/types";
import { ForwardInPlace, LinkDetail } from "./link-detail";
import { LinkEditor } from "./link-editor";
/**
 * A post, its editor and sending it share one dialog, so it never opens another on top of itself
 * and switching doesn't move it. The URL decides between the post and the editor: `edit`
 * alongside `post` is the editor opened from that post, over it. Sending is a step within one
 * opening of the post.
 */
export function LinkDialog() {
  const search = useSearch({ strict: false }),
    navigate = useNavigate();
  const open = !!(search.post || search.edit);
  // While it closes, the dialog keeps showing what it showed.
  const [last, setLast] = useState({ post: search.post, edit: search.edit });
  if (open && (last.post !== search.post || last.edit !== search.edit))
    setLast({ post: search.post, edit: search.edit });
  const { post, edit } = open ? search : last;
  const [sending, setSending] = useState<SavedLink>();
  // Each opening starts at the post.
  const [opened, setOpened] = useState(open);
  if (opened !== open) {
    setOpened(open);
    if (open) setSending(undefined);
  }
  const leave = (cleared: { post?: undefined; edit: undefined }) =>
    void navigate({
      to: ".",
      search: (old) => ({ ...old, ...cleared }),
      replace: true,
      resetScroll: false,
    });
  const close = () => leave({ post: undefined, edit: undefined });
  // Back to where the editor was opened: its post, or the page.
  const closeEditor = () => leave({ edit: undefined });
  const views: (ModalView & { title: string })[] = [];
  if (post)
    views.push({
      id: "post",
      title: "Post",
      content: (
        <LinkReference key={post} value={post} mode="post">
          {(id) => <LinkDetail id={id} />}
        </LinkReference>
      ),
    });
  if (post && sending)
    views.push({
      id: "send",
      title: "Send link",
      content: <SendLink link={sending} onBack={() => setSending(undefined)} />,
    });
  if (edit)
    views.push({
      id: "edit",
      title: "Edit link",
      content: (
        <LinkReference key={edit} value={edit} mode="edit">
          {(id) => <LinkEditor id={id} onDone={closeEditor} onClose={close} />}
        </LinkReference>
      ),
    });
  const top = views.at(-1);
  return (
    <Modal
      open={open}
      title={top?.title ?? "Post"}
      hideTitle
      fixedHeight
      // Comments grow the post downward instead of re-centering it.
      position="top"
      className={"link-dialog [&_.post-detail]:min-h-0 [&_.post-detail]:flex-1"}
      onOpenChange={(v) => {
        if (!v) close();
      }}
      onBack={
        top?.id === "send"
          ? () => setSending(undefined)
          : top?.id === "edit" && post
            ? closeEditor
            : undefined
      }
    >
      <ForwardInPlace.Provider value={setSending}>
        <ModalViews views={views} />
      </ForwardInPlace.Provider>
    </Modal>
  );
}
