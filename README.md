<p align="center">
  <img src="docs/screenshots/banner.png" alt="index" width="100%" />
</p>

<p align="center">
  <a href="apps/web/README.md">Web</a> ·
  <a href="apps/web/README.md#desktop">Desktop</a> ·
  <a href="apps/ios/README.md">iOS</a> ·
  <a href="docs/README.md">Documentation</a>
</p>

Index is a calm place for the links worth keeping. Each week gets one page: what caught your eye, next to what the people you follow found.

Paste a link to save it to this week, revisit earlier weeks, and organize your library with groups, Favorites and Starred. Follow people, comment on their links, or share a post in Messages.

<p align="center">
  <img src="docs/screenshots/home-desktop.png" alt="The home page on desktop: Week 41 with your links on top and the people you follow below" width="74%" />
</p>

Your profile is public or private. A private profile shares links only with approved followers. Locked groups stay yours regardless of profile visibility.

## Development

Index uses Bun and Turborepo, with a React web/Tauri desktop app, a Hono API on Cloudflare Workers, and a SwiftUI iOS app.

Use the Bun version in [package.json](package.json) and configure the [local environment](docs/deployment.md#local-development), then run from the repository root:

```sh
bun install --frozen-lockfile
bun dev
```

The web app runs at `http://localhost:3000`; Alchemy supplies its API and database bindings. Use `bun desktop:dev` for the same stack with the desktop app. Stop one workflow before starting the other.

Common checks, from the root:

```sh
VITE_SERVER_URL=http://localhost:3002 bun run check-types
bun test packages/api/src apps/server/src
bun run check:ios
```

The type check builds the web app; the example API origin is for disposable tests. The iOS check requires macOS, full Xcode and an available iPhone simulator. See [web/desktop development](apps/web/README.md), [iOS development](apps/ios/README.md), and the [guide index](docs/README.md) for focused checks and operations.
