# README screenshots

The README shows [hero.png](screenshots/hero.png) and [phones.png](screenshots/phones.png). From the root, `bun apps/web/scripts/readme-screenshots.ts` composes them from the raw [captures](screenshots/captures): it draws the stage, the iPhone frame and the captions, and renders them at 2x with the web app's Playwright Chromium. Change the layout or captions in that script, then rerun it.

## Captures

Recapture the affected screens after visible UI changes. Every capture shows `alice` from the disposable fixture API with sample data, in dark appearance.

1. In `apps/web`, start `E2E_MORE_SAMPLES=1 bun e2e/server.ts`, on other ports if the defaults are busy (see [web checks](../apps/web/README.md#checks)). The home week orders people by random account IDs, so `POST /_test/reset` until it opens with people who saved several links. A reset ends every session; settle on a seed before signing in.
2. Desktop: in `apps/web`, start Vite against that API with `VITE_SERVER_URL=<api> bun run dev:bare --port <port> --strictPort`, then run `bun run tauri dev --config src-tauri/tauri.dev.conf.json --config '{"build":{"devUrl":"http://localhost:<port>","beforeDevCommand":""}}'` with the same `VITE_SERVER_URL`. Sign in, choose Dark in Settings, keep the default window size and capture the home week with its window shadow: `screencapture -iw desktop-home.png`, then click the window.
3. iPhone: build the `Index` scheme for an iPhone 18 Pro simulator with `INDEX_API_URL=<api>` (see [Run](../apps/ios/README.md#run)). Run `xcrun simctl ui <udid> appearance dark` and `xcrun simctl status_bar <udid> override --time 9:41 --batteryState discharging --batteryLevel 100`, sign in, and take `xcrun simctl io <udid> screenshot` of the home week, the Radiohead – In Rainbows post, the conversation with Sofia Marques, Activity and your profile.
4. Save them in `captures` as `desktop-home.png` and `iphone-<home|post|conversation|activity|profile>.png`, scaled to the size the layout uses (`sips --resampleWidth 2000` for the desktop, `804` for the iPhone), and run the script.
