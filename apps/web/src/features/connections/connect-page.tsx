import { useEffect, useId, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@index/ui/components/button";
import { Checkbox } from "@index/ui/components/checkbox";
import wordmark from "@/assets/wordmark.svg";
import { sessionOptions } from "@/lib/session";
import { connections, safeLogo } from "./api";

/**
 * Where an MCP client's authorization request lands on the web origin. The API's authorize
 * endpoint sends the browser here to sign in and to approve; the answer goes back to the API,
 * which sends the browser on to the app. Signing in and email verification use the login page
 * and return here.
 */
export function ConnectPage() {
  const session = useQuery(sessionOptions);
  const navigate = useNavigate();
  // The authorization request the API signed. Read from the address bar: the router's parsed
  // search turns values such as a long numeric `state` into lossy numbers, and Better Auth
  // checks the exact signed values.
  const query = window.location.search.slice(1);
  const user = session.data?.user;
  const ready = !!user?.emailVerified;
  useEffect(() => {
    if (query && !session.isPending && !ready)
      void navigate({ to: "/login", search: { next: `/connect?${query}` }, replace: true });
  }, [navigate, query, ready, session.isPending]);
  if (!query)
    return (
      <ConnectFrame>
        <h2 className="text-[20px] font-semibold">Nothing to approve</h2>
        <p className="text-subtle-foreground">
          Start connecting from your app: add Index there with the MCP server URL in Settings.
        </p>
      </ConnectFrame>
    );
  if (!user || !ready)
    return (
      <ConnectFrame>
        <p role="status">Checking your session…</p>
      </ConnectFrame>
    );
  return (
    <ConnectFrame>
      <Approval query={query} account={user.username ?? user.email} />
    </ConnectFrame>
  );
}

function Approval({ query, account }: { query: string; account: string }) {
  const params = new URLSearchParams(query);
  const clientId = params.get("client_id") ?? "";
  const requested = params.get("scope")?.split(" ") ?? [];
  const [write, setWrite] = useState(requested.includes("write"));
  const writeId = useId();
  const app = useQuery({
    queryKey: ["connecting-app", clientId],
    queryFn: () => connections.app(clientId),
    retry: false,
  });
  const answer = useMutation({
    mutationFn: (accept: boolean) =>
      connections.answer(
        query,
        accept,
        accept ? requested.filter((scope) => scope !== "write" || write).join(" ") : undefined,
      ),
    // The API answers with the app's redirect URI, carrying a code or the refusal.
    onSuccess: ({ url }) => window.location.assign(url),
  });
  if (app.isPending) return <p role="status">Loading…</p>;
  if (app.error)
    return (
      <p role="alert" className="text-destructive">
        This app couldn’t be found. Start connecting again from the app.
      </p>
    );
  const name = app.data.client_name || "An app";
  const logo = safeLogo(app.data.logo_uri);
  // A metadata-document client's ID is an HTTPS URL its publisher controls.
  const domain = clientId.startsWith("https://") ? new URL(clientId).host : null;
  const busy = answer.isPending || answer.isSuccess;
  // Apps with their own URL scheme open outside the browser and leave this page behind.
  if (answer.isSuccess)
    return (
      <p role="status" className="text-center">
        Returning you to {name}. You can close this page.
      </p>
    );
  return (
    <div className="connect-approval flex flex-col gap-6">
      <header className="flex flex-col items-center gap-3 text-center">
        {logo && (
          <img
            src={logo}
            alt=""
            width={56}
            height={56}
            referrerPolicy="no-referrer"
            className="size-14 rounded-xl object-cover"
          />
        )}
        <h2 className="text-[20px] font-semibold leading-[1.25]">
          {name} wants to use your Index account
        </h2>
        <p className="text-subtle-foreground">
          Signed in as <strong className="text-foreground">{account}</strong>
          {domain && <> · App from {domain}</>}
        </p>
      </header>
      <ul className="flex flex-col gap-3 rounded-2xl border border-border p-4">
        <Permission
          title="Read"
          description="See everything you can see in Index: links, groups, profiles, messages and activity."
        >
          <Checkbox checked disabled aria-label="Read (always included)" />
        </Permission>
        {requested.includes("write") && (
          <Permission
            title="Write"
            htmlFor={writeId}
            description="Act as you: save and edit links, comment and forward."
          >
            <Checkbox id={writeId} checked={write} onCheckedChange={setWrite} disabled={busy} />
          </Permission>
        )}
      </ul>
      {answer.error && (
        <p role="alert" className="field-error select-text text-[12px] text-destructive">
          {answer.error.message}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <Button className="h-11" disabled={busy} onClick={() => answer.mutate(true)}>
          {answer.isPending && answer.variables ? "Connecting…" : "Allow"}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => answer.mutate(false)}>
          Deny
        </Button>
      </div>
      <p className="text-center text-[12px] text-subtle-foreground">
        You can disconnect it at any time in Settings → Connections.
      </p>
    </div>
  );
}

function Permission({
  title,
  description,
  htmlFor,
  children,
}: {
  title: string;
  description: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  const Label = htmlFor ? "label" : "span";
  return (
    <li className="flex items-start gap-3">
      <span className="pt-0.5">{children}</span>
      <Label htmlFor={htmlFor} className="flex flex-col">
        <span className="text-[14px] font-medium">{title}</span>
        <span className="text-[12px] leading-4 text-subtle-foreground">{description}</span>
      </Label>
    </li>
  );
}

function ConnectFrame({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page select-none bg-background text-foreground text-[14px] leading-[1.5] min-h-dvh grid place-items-center p-[40px_24px]">
      <div className="w-[min(100%,_400px)]">
        <h1 className="flex justify-center mb-12 [&_img]:h-8.5 [&_img]:invert dark:[&_img]:invert-0">
          <img src={wordmark} alt="Index" />
        </h1>
        {children}
      </div>
    </main>
  );
}
