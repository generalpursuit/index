import { useEffect, useRef } from "react";
import {
  Link,
  Outlet,
  useMatches,
  useNavigate,
  useRouter,
  useRouterState,
  useSearch,
} from "@tanstack/react-router";
import { Search, Bell, User, MessageCircle, Settings } from "lucide-react";
import { Modal } from "@index/ui/components/modal";
import { QueryState } from "@/components/app/query-state";
import brandSymbol from "@/assets/brand-symbol.svg";
import { LinkReference } from "@/features/routes/link-reference";
import { ProfileLink } from "@/components/app/profile-link";
import { useViewer } from "@/hooks/use-api";
import { useUnread } from "@/features/activity/hooks/use-activity";
import { useBack, useEdgeBack } from "@/hooks/use-back";
import { MessageDraftProvider } from "@/features/messages/drafts";
import { LinkDraftProvider } from "@/features/links/drafts";
import { queryClient } from "@/utils/orpc";
import { useWarmUp } from "@/hooks/use-warm-up";

// Shared by instances in this component; markers remain available to scroll hooks/tests.
const navItemClassName =
  "nav-item [&.nav-settings]:absolute [&.nav-settings]:bottom-7 relative flex items-center justify-center w-11 h-11 text-subtle-foreground rounded-full [&_svg]:w-6.25 [&_svg]:h-6.25 [&_svg]:stroke-[1.7] [&[data-status='active']]:text-foreground [&:hover]:text-foreground [&[data-status='active']_.nav-brand]:opacity-[1] [&:hover_.nav-brand]:opacity-[1]";
const unreadDotClassName =
  "unread-dot absolute w-1.5 h-1.5 right-1.75 top-1.75 bg-foreground rounded-full [box-shadow:0_0_0_3px_var(--background)]";

export function AppShell() {
  const viewer = useViewer(),
    unread = useUnread(),
    navigate = useNavigate(),
    router = useRouter();
  const path = useRouterState({ select: (s) => s.location.pathname }),
    search = useSearch({ strict: false }),
    prior = useRef(viewer?.id);
  const back = useBack(),
    swipe = useEdgeBack(back);
  // The page on screen, not the one loading: the location changes before the next page is ready.
  const layout = useMatches({ select: (matches) => matches.at(-1)?.staticData.layout });
  const feed = layout === "feed",
    chat = layout === "chat";
  useWarmUp(viewer);
  useEffect(() => {
    if (prior.current !== viewer?.id) {
      const old = prior.current;
      prior.current = viewer?.id;
      if (old) {
        void queryClient.cancelQueries({ queryKey: [["viewer", old]] });
        queryClient.removeQueries({ queryKey: [["viewer", old]] });
        void router.invalidate();
      }
    }
  }, [viewer?.id, router]);
  const protectedPage =
    !path.startsWith("/people/") &&
    !path.startsWith("/links/") &&
    !path.startsWith("/u/") &&
    !path.startsWith("/l/");
  useEffect(() => {
    if (!viewer && protectedPage)
      void navigate({ to: "/login", search: { next: router.state.location.href }, replace: true });
  }, [viewer, protectedPage, navigate, router]);
  // Closing returns to exactly where the editor was opened.
  const closeEditor = () =>
    void navigate({
      to: ".",
      search: (old) => ({ ...old, edit: undefined }),
      replace: true,
      resetScroll: false,
    });
  return (
    <MessageDraftProvider key={viewer?.id ?? "guest"}>
      <LinkDraftProvider>
        <div
          className={
            "index-app select-none bg-background text-foreground text-[14px] leading-[1.5] h-dvh overflow-hidden [&_h1]:font-semibold [&_h1]:tracking-[-0.035em] [&_h1]:leading-[1.1] [&_h1]:text-[clamp(34px,_4vw,_56px)] [@media(width<=700px)]:text-[13px] [@media(width<=700px)]:[&_h1]:text-[40px]"
          }
        >
          <a
            href="#app-content"
            className={
              "skip-link fixed top-[-100px] left-5 z-100 bg-foreground text-background p-3 [&:focus]:top-3"
            }
          >
            Skip navigation
          </a>
          <nav
            className={
              "app-nav fixed left-6 top-0 bottom-0 flex flex-col justify-center gap-5.5 z-20 items-center [@media(width<=700px)]:top-auto [@media(width<=700px)]:bottom-0 [@media(width<=700px)]:left-0 [@media(width<=700px)]:right-0 [@media(width<=700px)]:[transform:none] [@media(width<=700px)]:flex-row [@media(width<=700px)]:justify-around [@media(width<=700px)]:gap-0 [@media(width<=700px)]:p-[8px_8px_calc(8px_+_env(safe-area-inset-bottom))] [@media(width<=700px)]:h-[calc(66px_+_env(safe-area-inset-bottom))] [@media(width<=700px)]:bg-background [@media(width<=700px)]:z-30"
            }
            aria-label="Main navigation"
          >
            <Link
              to="/"
              className={navItemClassName}
              aria-label="Home"
              activeOptions={{ exact: true }}
            >
              <img
                className={"nav-brand invert dark:invert-0 block w-auto h-6.25 opacity-[0.52]"}
                src={brandSymbol}
                alt=""
                aria-hidden="true"
              />
            </Link>
            <Link to="/discover" className={navItemClassName} aria-label="Discover">
              <Search />
            </Link>
            <Link to="/activity" className={navItemClassName} aria-label="Activity">
              <Bell />
              {unread.activity > 0 && <i className={unreadDotClassName} />}
            </Link>
            <Link to="/messages" className={navItemClassName} aria-label="Messages">
              <MessageCircle />
              {unread.messages > 0 && <i className={unreadDotClassName} />}
            </Link>
            {viewer ? (
              <ProfileLink person={viewer} className={navItemClassName} aria-label="Your profile">
                <User />
              </ProfileLink>
            ) : (
              <Link to="/login" className={navItemClassName} aria-label="Sign in">
                <User />
              </Link>
            )}
            {/* At the foot of the rail on larger screens; phones open Settings from the profile. */}
            {viewer && (
              <Link
                to="/settings"
                className={
                  "nav-item [&.nav-settings]:absolute [&.nav-settings]:bottom-7 relative flex items-center justify-center w-11 h-11 text-subtle-foreground rounded-full [&_svg]:w-6.25 [&_svg]:h-6.25 [&_svg]:stroke-[1.7] [&[data-status='active']]:text-foreground [&:hover]:text-foreground [&[data-status='active']_.nav-brand]:opacity-[1] [&:hover_.nav-brand]:opacity-[1] nav-settings [@media(width<=700px)]:hidden"
                }
                aria-label="Settings"
              >
                <Settings />
              </Link>
            )}
          </nav>
          <main
            id="app-content"
            className={
              "app-main h-full pl-25 [@media(width<=700px)]:[&_.app-content:has(.week-scrubber)]:pr-9 [@media(width<=700px)]:pl-0 [@media(width<=700px)]:pb-[calc(66px_+_env(safe-area-inset-bottom))] " +
              (feed
                ? "feed-main [&_.app-content]:h-full [&_.app-content]:pt-0 [&_.app-content]:pb-0 [&_.app-scroll]:overflow-hidden [@media(width<=700px)]:[&_.app-content]:p-[0_20px]"
                : chat
                  ? "chat-main [&_.app-content]:h-full [&_.app-content]:pt-7 [&_.app-content]:pb-6 [&_.app-scroll]:overflow-hidden [@media(width<=700px)]:[&_.app-content]:p-[20px_16px_12px] [@media(width<=700px)]:[&_.chat-heading]:mb-4.5"
                  : "")
            }
            {...(!feed ? swipe : {})}
          >
            <div
              id="app-scroll"
              data-scroll-restoration-id="app-scroll"
              className={"app-scroll h-full overflow-y-auto overscroll-y-contain"}
            >
              <div
                className={
                  "app-content [--page-top-space:40px] w-[min(100%,_820px)] p-[var(--page-top-space)_40px_50px] m-auto [@media(width<=700px)]:p-[var(--page-top-space)_20px_28px] [@media(width<=700px)_and_(height<=740px)]:[--page-top-space:36px]"
                }
              >
                {!viewer && protectedPage ? <QueryState pending /> : <Outlet />}
              </div>
            </div>
          </main>
          <Modal
            open={!!search.post}
            title="Post"
            hideTitle
            size="lg"
            className={
              "post-dialog h-[min(820px,_calc(100dvh_-_40px))] [&_.post-detail]:min-h-0 [&_.post-detail]:flex-1"
            }
            onOpenChange={(v) => {
              if (!v)
                void navigate({
                  to: ".",
                  search: (old) => ({ ...old, post: undefined }),
                  replace: true,
                  resetScroll: false,
                });
            }}
          >
            {search.post ? (
              <LinkReference key={search.post} value={search.post} mode="post" onDone={() => {}} />
            ) : (
              <QueryState pending />
            )}
          </Modal>
          <Modal
            open={!!search.edit}
            title="Edit link"
            size="md"
            className="editor-dialog"
            onOpenChange={(v) => {
              if (!v) closeEditor();
            }}
          >
            {search.edit && (
              <LinkReference
                key={search.edit}
                value={search.edit}
                mode="edit"
                onDone={closeEditor}
              />
            )}
          </Modal>
        </div>
      </LinkDraftProvider>
    </MessageDraftProvider>
  );
}
