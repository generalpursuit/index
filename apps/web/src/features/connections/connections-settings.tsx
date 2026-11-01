import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@index/ui/components/button";
import { Confirmation } from "@index/ui/components/confirmation";
import { accountMutationOptions } from "@/lib/account-boundary";
import { useViewer } from "@/hooks/use-api";
import { rowButtonClassName, SettingsGroup, SettingsRow } from "@/features/settings/rows";
import { connections, mcpServerURL, safeLogo, type Connection } from "./api";

const connectedOn = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * The MCP server URL to paste into an agent, and the apps already connected. Disconnecting
 * an app stops its next request.
 */
export function ConnectionsSettings() {
  const viewer = useViewer();
  const key = ["connections", viewer?.id];
  const list = useQuery({
    queryKey: key,
    queryFn: () => connections.list().then((result) => result.connections),
    enabled: !!viewer,
  });
  return (
    <SettingsGroup
      title="Connections"
      footer={
        list.error
          ? "Connected apps couldn’t be loaded."
          : list.data?.length === 0 && "No apps are connected."
      }
    >
      <SettingsRow
        label="MCP server URL"
        description={
          <>
            Add it to an MCP client, such as an AI assistant, to use Index there.{" "}
            <code className="select-all font-mono break-all text-foreground">{mcpServerURL}</code>
          </>
        }
      >
        <Button
          variant="outline"
          className={rowButtonClassName}
          onClick={() =>
            void navigator.clipboard
              .writeText(mcpServerURL)
              .then(() => toast.success("MCP server URL copied"))
              .catch(() => toast.error("Could not copy the URL. Select and copy it instead."))
          }
        >
          Copy
        </Button>
      </SettingsRow>
      {list.data?.map((connection) => (
        <ConnectedApp key={connection.clientId} connection={connection} listKey={key} />
      ))}
    </SettingsGroup>
  );
}

function ConnectedApp({ connection, listKey }: { connection: Connection; listKey: unknown[] }) {
  const cache = useQueryClient();
  const [asking, setAsking] = useState(false);
  const name = connection.name || "Unnamed app";
  const logo = safeLogo(connection.logoUri);
  const revoke = useMutation(
    accountMutationOptions({
      mutationFn: () => connections.revoke(connection.clientId),
      onSuccess: () => {
        setAsking(false);
        toast.success(`${name} disconnected`);
        return cache.invalidateQueries({ queryKey: listKey });
      },
      onError: (error: Error) => toast.error(error.message),
    }),
  );
  const access = connection.permission === "write" ? "Read and write" : "Read only";
  return (
    <SettingsRow
      className="connected-app"
      label={
        <span className="flex items-center gap-2">
          {logo && (
            <img
              src={logo}
              alt=""
              width={20}
              height={20}
              referrerPolicy="no-referrer"
              className="size-5 rounded-md object-cover"
            />
          )}
          {name}
        </span>
      }
      description={
        connection.connectedAt
          ? `${access} · Connected ${connectedOn.format(new Date(connection.connectedAt))}`
          : access
      }
    >
      <Button
        variant="outline"
        className={rowButtonClassName}
        aria-label={`Disconnect ${name}`}
        onClick={() => setAsking(true)}
      >
        Disconnect
      </Button>
      <Confirmation
        open={asking}
        onOpenChange={setAsking}
        title={`Disconnect ${name}?`}
        description="It loses access to your Index account at once. You can connect it again from the app."
        label="Disconnect"
        destructive
        pending={revoke.isPending}
        onConfirm={() => revoke.mutate()}
      />
    </SettingsRow>
  );
}
