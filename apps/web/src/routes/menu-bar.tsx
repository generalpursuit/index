import { createFileRoute } from "@tanstack/react-router";
import { MenuBarPage } from "@/features/menu-bar/menu-bar-page";
export const Route = createFileRoute("/menu-bar")({ component: MenuBarPage });
