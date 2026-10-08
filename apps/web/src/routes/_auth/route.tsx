import { Outlet, createFileRoute } from "@tanstack/react-router";
import { requireSession } from "@/lib/session";
export const Route = createFileRoute("/_auth")({ component: Outlet, beforeLoad: requireSession });
