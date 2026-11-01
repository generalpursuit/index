import { createFileRoute } from "@tanstack/react-router";
import { ConnectPage } from "@/features/connections/connect-page";

export const Route = createFileRoute("/connect")({ component: ConnectPage });
