// Injected by the opt-in Rust smoke plugin into the real packaged WKWebView.
(async () => {
  if (window.__nativeSmokeStarted) return;
  window.__nativeSmokeStarted = true;
  const invoke = window.__TAURI__.core.invoke;
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const waitFor = async (read, label) => {
    for (let i = 0; i < 150; i++) {
      const value = await read();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Timed out waiting for ${label}`);
  };
  const button = (label) =>
    [...document.querySelectorAll("button")].find(
      (node) =>
        !node.closest("[inert]") &&
        (node.textContent.trim() === label || node.getAttribute("aria-label") === label),
    );
  const activePage = () => document.querySelector('.week-page[data-active="true"]');
  const week = () =>
    document.querySelector(".week-feed > .page-heading h1")?.textContent.includes("Week");
  const input = (type, value) => {
    const node = document.querySelector(`input[type="${type}"]`);
    assert(node, `Missing ${type} field`);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  };
  try {
    await invoke("smoke_progress", { message: "JavaScript bridge ready" });
    if (window.__SMOKE_PHASE__.startsWith("icons")) {
      const restored = await invoke("app_icon_status");
      assert(restored.supported, "macOS icon selection unavailable");
      if (window.__SMOKE_PHASE__ === "icons-restore") {
        assert(restored.icon === "paper", "App icon preference did not survive process restart");
        assert(
          await invoke("smoke_icon_matches", { paper: true }),
          "Saved icon was not restored to AppKit at launch",
        );
        await invoke("set_app_icon", { icon: "ink" });
        assert(await invoke("smoke_icon_matches", { paper: false }), "Default icon did not return");
      } else {
        await invoke("set_app_icon", { icon: "ink" });
        assert(
          await invoke("smoke_icon_matches", { paper: false }),
          "Ink was not applied to AppKit",
        );
        let rejected = false;
        try {
          await invoke("set_app_icon", { icon: "unknown" });
        } catch {
          rejected = true;
        }
        assert(rejected, "Native bridge accepted an unsupported icon");
        assert(
          (await invoke("app_icon_status")).icon === "ink",
          "Rejected icon changed the preference",
        );
        await invoke("set_app_icon", { icon: "paper" });
        assert(
          await invoke("smoke_icon_matches", { paper: true }),
          "Paper was not applied to AppKit",
        );
      }
      await invoke("smoke_complete", { error: null });
      return;
    }
    // The fixture URL is enforced at compile time by Rust, never configurable to production.
    assert((await fetch("http://localhost:3002/_test/fixture")).ok, "Fixture backend unavailable");
    await invoke("smoke_progress", { message: "Fixture API reachable" });
    await invoke("session_read");
    await invoke("smoke_progress", { message: "Keychain read completed" });
    if (window.__SMOKE_PHASE__ === "login") {
      await waitFor(() => button("Sign in"), "login screen");
      await invoke("smoke_progress", { message: "Login form ready" });
      input("email", "alice@test.example");
      input("password", "test-password-123");
      await new Promise((resolve) => setTimeout(resolve, 100));
      button("Sign in").click();
      await waitFor(week, "authenticated weekly feed");
      await invoke("smoke_progress", { message: "Signed in through the UI" });
      assert(
        (await invoke("session_read"))?.includes("."),
        "Signed credential was not persisted in Keychain",
      );
      assert(
        document.querySelector('[data-desktop="true"]'),
        "Native frontend adapter is not active",
      );
      await waitFor(() => button("Actions for Are.na"), "API-backed link list");
      let rejected = false;
      try {
        await invoke("open_website", { url: "file:///etc/passwd" });
      } catch {
        rejected = true;
      }
      assert(rejected, "Native opener accepted a non-web URL");
      // Confirm the OS opener can dispatch a harmless public website.
      await invoke("open_website", { url: "https://example.com/" });
      for (const [width, height] of [
        [390, 844],
        [1200, 860],
      ]) {
        await invoke("smoke_resize", { width, height });
        await new Promise((resolve) => setTimeout(resolve, 400));
        assert(
          document.documentElement.scrollWidth <= window.innerWidth + 1,
          "Layout overflows the native window",
        );
        assert(week(), "Feed disappeared while resizing");
      }
      const initialWeek = activePage().dataset.week;
      const pager = document.querySelector(".week-pager");
      const positions = [];
      pager.addEventListener("scroll", () => positions.push(pager.scrollTop));
      button("Older week").click();
      await waitFor(() => activePage()?.dataset.week !== initialWeek, "native week snap");
      assert(activePage().textContent.includes("Earlier notes"), "Week data did not change");
      assert(
        positions.some((top) => top > 2 && top < pager.clientHeight - 2),
        "Week changed without visible scrolling",
      );
      assert(
        Math.abs(pager.scrollTop % pager.clientHeight) < 2,
        "Week did not settle at its snap point",
      );
      button("Newer week").click();
      await waitFor(() => activePage()?.dataset.week === initialWeek, "return to the current week");
      await invoke("smoke_progress", {
        message: "Native week scrolling, snapping, and content verified",
      });
      // Keep the credential for the next process, which proves restoration after a real restart.
    } else if (window.__SMOKE_PHASE__ === "restore") {
      await waitFor(week, "Keychain session restoration");
      await waitFor(() => button("Actions for Are.na"), "restored API-backed feed");
      (
        await waitFor(
          () => document.querySelector('a[aria-label="Your profile"]'),
          "profile navigation",
        )
      ).click();
      (
        await waitFor(
          () => document.querySelector('a[aria-label="Settings"]'),
          "settings navigation",
        )
      ).click();
      (await waitFor(() => button("Sign out"), "sign-out action")).click();
      await waitFor(() => button("Sign in"), "logout screen");
      await waitFor(
        async () => (await invoke("session_read")) === null,
        "Keychain credential deletion",
      );
    } else {
      await waitFor(() => button("Sign in"), "signed-out restart");
      assert((await invoke("session_read")) === null, "Logout credential returned after restart");
    }
    await invoke("smoke_complete", { error: null });
  } catch (error) {
    await invoke("smoke_complete", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
})();
