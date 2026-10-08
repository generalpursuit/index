import { useEffect, useRef } from "react";
import {
  Link,
  Outlet,
  useNavigate,
  useRouter,
  useRouterState,
  useSearch,
} from "@tanstack/react-router";
import { Home, Users, Plus, Bell, User, MessageCircle, LogOut } from "lucide-react";
import { Button } from "@index/ui/components/button";
import { Modal, QueryState } from "./primitives";
import { LinkDetail } from "@/features/links/link-detail";
import { useViewer } from "@/hooks/use-api";
import { useUnread } from "@/features/activity/hooks/use-activity";
import { useBack, useEdgeBack } from "@/hooks/use-back";
import { DraftProvider } from "@/hooks/use-draft";
import { authClient } from "@/lib/auth-client";
import { resetSession } from "@/lib/session";
import { queryClient } from "@/utils/orpc";
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
  const feed = path === "/",
    chat = path.startsWith("/messages/");
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
  const protectedPage = !path.startsWith("/people/") && !path.startsWith("/links/");
  useEffect(() => {
    if (!viewer && protectedPage)
      void navigate({ to: "/login", search: { next: router.state.location.href }, replace: true });
  }, [viewer, protectedPage, navigate, router]);
  async function signOut() {
    await authClient.signOut();
    await resetSession();
    await router.invalidate();
    await navigate({ to: "/login" });
  }
  return (
    <DraftProvider key={viewer?.id ?? "guest"}>
      <div className="index-app">
        <a href="#app-content" className="skip-link">
          Skip navigation
        </a>
        <nav className="app-nav" aria-label="Main navigation">
          <Link to="/" className="nav-item" aria-label="Home" activeOptions={{ exact: true }}>
            <Home />
          </Link>
          <Link to="/discover" className="nav-item" aria-label="Discover">
            <Users />
          </Link>
          <Link to="/add" className="nav-item" aria-label="Add link">
            <Plus />
          </Link>
          <Link to="/activity" className="nav-item" aria-label="Activity">
            <Bell />
            {unread.activity > 0 && <i className="unread-dot" />}
          </Link>
          <Link to="/messages" className="nav-item desktop-nav" aria-label="Messages">
            <MessageCircle />
            {unread.messages > 0 && <i className="unread-dot" />}
          </Link>
          {viewer ? (
            <Link
              to="/people/$userId"
              params={{ userId: viewer.id }}
              className="nav-item"
              aria-label="Your profile"
            >
              <User />
            </Link>
          ) : (
            <Link to="/login" className="nav-item" aria-label="Sign in">
              <User />
            </Link>
          )}
          {viewer && (
            <Button
              variant="ghost"
              size="icon"
              className="desktop-nav sign-out"
              aria-label="Sign out"
              onClick={() => void signOut()}
            >
              <LogOut />
            </Button>
          )}
        </nav>
        <main
          id="app-content"
          className={"app-main " + (feed ? "feed-main" : chat ? "chat-main" : "")}
          {...(!feed ? swipe : {})}
        >
          <div id="app-scroll" data-scroll-restoration-id="app-scroll" className="app-scroll">
            <div className="app-content">
              {!viewer && protectedPage ? <QueryState pending /> : <Outlet />}
            </div>
            {viewer && path === "/people/" + viewer.id && (
              <Button className="mobile-sign-out" variant="ghost" onClick={() => void signOut()}>
                Sign out
              </Button>
            )}
          </div>
        </main>
        <Modal
          open={!!search.post}
          title="Post"
          className="post-dialog"
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
          {search.post ? <LinkDetail key={search.post} id={search.post} /> : <QueryState pending />}
        </Modal>
      </div>
    </DraftProvider>
  );
}
