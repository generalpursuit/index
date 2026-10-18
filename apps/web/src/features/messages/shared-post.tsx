import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Link2, LockKeyhole } from "lucide-react";
import { ProfileLink } from "@/components/app/profile-link";
import { useAPI } from "@/hooks/use-api";
import { modalNavigation } from "@/lib/search";
import { domain } from "@/features/links/url";
import { preparePost } from "@/features/links/queries";
import type { Message } from "@/lib/types";

// A card is its own surface beside the bubbles, so it never inherits a bubble's colours. File
// cards share the look but not the `shared-post` marker, which Enter in the thread looks for.
// `message-surface` is the thread's marker for what its focus and highlight rings outline.
export const cardStyle =
  "flex items-center gap-3 w-70 max-w-full p-[10px_14px] border border-border rounded-[16px] bg-surface text-left leading-[1.3] [&>svg]:flex-none [&>svg]:size-4 [&>svg]:text-subtle-foreground [&>span]:flex [&>span]:flex-col [&>span]:gap-0.5 [&>span]:min-w-0 [&_strong]:font-medium [&_strong]:wrap-anywhere [&_small]:text-[12px] [&_small]:text-subtle-foreground [&_small]:wrap-anywhere";
const cardClassName = "shared-post message-surface " + cardStyle;
export const actionClassName =
  "text-foreground cursor-pointer [transition:background_150ms_ease] hover:bg-muted outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** A message's post. Its message is the tab stop and opens it with Enter. */
export function SharedPost({ message }: { message: Message }) {
  const navigate = useNavigate(),
    cache = useQueryClient(),
    api = useAPI();
  if (message.attachment) {
    const prepare = () => preparePost(cache, api, message.attachment!);
    return (
      <button
        type="button"
        tabIndex={-1}
        className={cardClassName + " " + actionClassName}
        onPointerEnter={prepare}
        onFocus={prepare}
        onClick={() => {
          prepare();
          void navigate(modalNavigation({ post: message.attachment!.shortId }));
        }}
      >
        <Link2 />
        <span>
          <strong>{message.attachment.title}</strong>
          <small>{domain(message.attachment.url)}</small>
        </span>
      </button>
    );
  }
  if (message.restrictedAuthor)
    return (
      <ProfileLink
        className={
          cardClassName +
          " " +
          actionClassName +
          " restricted [&>span>span]:text-[12px] [&>span>span]:underline [&>span>span]:underline-offset-[3px] [&>span>span]:mt-1"
        }
        person={message.restrictedAuthor}
        tabIndex={-1}
      >
        <LockKeyhole />
        <span>
          <strong>
            Private post from @{message.restrictedAuthor.username ?? message.restrictedAuthor.name}
          </strong>
          <small>Only approved followers can view this post.</small>
          <span>View profile</span>
        </span>
      </ProfileLink>
    );
  return message.hasAttachment ? (
    <div className={cardClassName + " unavailable text-subtle-foreground"}>
      <LockKeyhole />
      <span>Post unavailable</span>
    </div>
  ) : null;
}
