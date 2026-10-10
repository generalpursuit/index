import type { Page } from "@playwright/test";

/** In-memory model of the IPC contract, shared by two real browser pages.
 * This does not exercise AppKit, Tauri, Keychain, ServiceManagement or notifications. */
export class DesktopHarness {
  token: string | null = null;
  revision = 0;
  pages = new Map<string, Page>();
  commands: { label: string; command: string; args?: Record<string, any> }[] = [];
  opened: string[] = [];
  appearances: { label: string; preference?: string; resolved?: string }[] = [];
  events: { event: string; payload: unknown }[] = [];
  stopCleanup: Promise<void> | undefined;
  suppressed = new Set<string>();
  heldNotification: { command: string; revision: number; wait: Promise<void> } | undefined;
  rejectedNotifications = 0;
  registeredAccount: string | null = null;
  stopped = 0;
  loginState = "off";
  loginSupported = true;
  loginError = false;
  quits = 0;
  hidden: string[] = [];
  pending: { id: number; path: string; recipientId: string | null } | null = null;
  private nextNavigation = 1;
  private queue: Promise<unknown> = Promise.resolve();
  async emit(event: string, payload: unknown, target?: string) {
    this.events.push({ event, payload });
    await Promise.all(
      [...this.pages.entries()]
        .filter(
          ([label, page]) =>
            (!target || target === label) && !this.suppressed.has(label) && !page.isClosed(),
        )
        .map(async ([, page]) => {
          await page.evaluate(
            ({ event, payload }) => {
              (window as any).__desktopListeners
                ?.get(event)
                ?.forEach((callback: (value: unknown) => void) => callback({ payload }));
            },
            { event, payload },
          );
        }),
    );
  }
  async attach(page: Page, label: string) {
    this.pages.set(label, page);
    await page.exposeBinding(
      "nativeCommand",
      async (_source, command: string, args: Record<string, any> = {}) => {
        this.commands.push({ label, command, args });
        const check = () => {
          if (args.expectedRevision !== this.revision) throw new Error("Session changed");
        };
        if (
          [
            "session_read",
            "session_snapshot",
            "session_revision",
            "session_write",
            "session_compare_write",
            "session_touch",
          ].includes(command)
        ) {
          const operation = this.queue.then(async () => {
            if (command === "session_read") return this.token;
            if (command === "session_snapshot")
              return { token: this.token, revision: this.revision };
            if (command === "session_revision") return this.revision;
            if (command !== "session_write") check();
            if (command !== "session_touch") {
              if (args.token !== null && this.token === args.token) return this.revision;
              this.token = args.token ?? null;
              if (!this.token) this.registeredAccount = null;
            }
            this.revision++;
            await this.emit("index:desktop-session", { revision: this.revision, source: label });
            return this.revision;
          });
          this.queue = operation.catch(() => {});
          return operation;
        }
        if (command === "set_appearance") {
          this.appearances.push({ label, ...args });
          return;
        }
        if (command === "desktop_window") return label;
        if (command === "desktop_changed") {
          check();
          await this.emit("index:desktop-data", { revision: this.revision, source: label });
          return;
        }
        if (command === "desktop_open") {
          check();
          if (args.path)
            this.pending = {
              id: this.nextNavigation++,
              path: args.path,
              recipientId: args.recipientId ?? null,
            };
          await this.emit("index:desktop-open", null, "main");
          return;
        }
        if (command === "desktop_take_navigation") {
          check();
          if (label !== "main") throw new Error("Only main can navigate");
          if (args.ack === this.pending?.id) this.pending = null;
          return this.pending;
        }
        if (command === "desktop_panel_ready") {
          check();
          return;
        }
        if (command === "desktop_hide") {
          this.hidden.push(label);
          return;
        }
        if (command === "desktop_quit") {
          this.quits++;
          return;
        }
        if (command === "launch_at_login_status")
          return { supported: this.loginSupported, state: this.loginState };
        if (command === "launch_at_login_set") {
          if (this.loginError) throw new Error("OS denied request");
          this.loginState = args.enabled ? "requires-approval" : "off";
          return { supported: this.loginSupported, state: this.loginState };
        }
        if (command === "launch_at_login_settings") return;
        if (command.startsWith("notification_")) {
          const held = this.heldNotification;
          if (held?.command === command && held.revision === args.expectedRevision) await held.wait;
          try {
            check();
          } catch (error) {
            this.rejectedNotifications++;
            throw error;
          }
          if (command === "notification_status")
            return {
              permission: this.registeredAccount ? "granted" : "default",
              registered: !!this.registeredAccount,
              supported: true,
            };
          if (command === "notification_active") return;
          if (command === "notification_take_click") return null;
          if (command === "notification_start") {
            this.registeredAccount = args.userId;
            return;
          }
          if (command === "notification_stop") {
            this.registeredAccount = null;
            this.stopped++;
            return this.stopCleanup;
          }
        }
        if (command === "open_website") {
          const url = new URL(args.url);
          if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
            throw new Error("Only HTTP(S) websites can open");
          this.opened.push(url.href);
          return;
        }
        throw new Error("Unexpected native command " + command);
      },
    );
    await page.addInitScript((menu) => {
      const listeners = new Map<string, Set<(value: unknown) => void>>();
      Object.assign(window, {
        __INDEX_MENU_BAR__: menu,
        __desktopListeners: listeners,
        __TAURI_INTERNALS__: {},
        __TAURI__: {
          core: {
            invoke: (command: string, args: unknown) =>
              (window as any).nativeCommand(command, args),
          },
          event: {
            listen: async (name: string, callback: (value: unknown) => void) => {
              const set = listeners.get(name) ?? new Set();
              set.add(callback);
              listeners.set(name, set);
              return () => set.delete(callback);
            },
          },
        },
      });
    }, label === "menu-bar");
  }
}
