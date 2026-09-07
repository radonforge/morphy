# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

morphy.lol is a browser multiplayer prop-hunt game: low-poly 3D, LAN-first, server-authoritative. Hunters stalk players disguised as scene objects (props). The code is the source of truth.

## Commands

```bash
pnpm install            # Node ≥ 24, pnpm 11 (the version is pinned in package.json)
pnpm dev                # server (Colyseus :2567) + client (Vite :5173) in parallel
pnpm dev:server         # tsx watch — server only
pnpm dev:client         # vite — client only
pnpm bot                # headless bots against a running server — see packages/bot/README.md
pnpm typecheck          # tsc --noEmit across all packages
pnpm check              # Biome lint + format (also: check:write, format, lint)
pnpm test               # node:test suite under tests/
pnpm check:ci           # the non-mutating Biome gate CI runs
pnpm tunnel             # ngrok http 5173 — share a LAN/remote session
pnpm --filter @morphy/client build   # production client bundle
```

CI (`.github/workflows/ci.yml`) runs `pnpm check:ci`, `pnpm typecheck`, `pnpm test` and a production
client build on every pull request — run the same four locally after changes. The suite in
`tests/` is plain `node:test` over the real modules (validators, map builders, geometry, storage,
HTTP endpoints, bot scheduling, room lifecycle); there is no mocking framework and no browser
test. Verification beyond that is manual play.

Single-package typecheck: `pnpm --filter @morphy/server typecheck` (or `@morphy/client` / `@morphy/shared`).

## Architecture

pnpm-workspace monorepo, four packages with a strict runtime dependency direction:
**client → shared ← server**, plus **bot → shared** and **server → bot/brain** (client and server
still never import each other at runtime).

`server → bot` exists so the room-filling bots and the CLI bots run the *same* behaviour instead of
two copies that drift. It is confined to the `@morphy/bot/brain` entry point — the package's
`exports` map deliberately splits the transport-free half (`driver.ts`, `reflex.ts`, `view.ts`,
`nav/`, `policy/`) from `bot.ts`, the only module that touches `@colyseus/sdk`. Import
`@morphy/bot/brain` from the server, never `@morphy/bot`, or the SDK lands in the server's graph.

The other deliberate exception is build-time: `packages/client/runtimeAssets.ts` imports the map
builders and prop catalogs from `../server/src/…` so the production GLB allow-list is derived from
the same data the server emits. Nothing of it reaches the browser — the Vite plugin consuming it is
`apply: "build"`.

### `packages/shared` — the contract layer

The single source of truth for everything client and server must agree on. **Exports raw TypeScript** (`"exports": { ".": "./src/index.ts" }`, no build step) — both sides consume the source directly via the `@morphy/shared` workspace alias.

- `constants.ts` — all gameplay tuning (durations, ratios, speeds, ranges, limits). No gameplay magic numbers live anywhere else.
- `protocol.ts` — network message **name constants** (`MSG_INPUT`, `MSG_SHOOT`, …) plus the payload interfaces. Messages are individual Colyseus channels keyed by these string constants, **not** a single tagged union.
- `map.ts` — the `MapDefinition` data model, `parseMapDefinition` (boundary validation, throws `MapValidationError`), and `computePropBounds` (derives a prop's bounding cylinder from its primitive parts — **shared by server hit detection and client mesh fitting**, so they always agree on hitboxes).
- `maps.ts` — `MAP_CATALOG` (the three selectable maps and their lobby metadata), `MapId`, `isMapId`. The client renders the picker straight from it; the server keys `MAP_BUILDERS` on the same ids as a `Record<MapId, …>`, so a half-added map fails `typecheck`.
- `weapons.ts`, `avatars.ts` — the selectable weapon and avatar catalogs, same catalog-plus-validator shape.
- `party.ts` — private-room codes over a look-alike-free alphabet; the code **is** the Colyseus roomId, so joining a party is a plain `joinById(code)`.
- `agent.ts` — the two-level `Policy` / `Intent` contract shared by server and bot.
- `geometry.ts` — `rayAabb` and friends, shared by server hit resolution and the bot's hit prediction.
- `async.ts` — `withTimeout`, which forces callers to dispose a value that resolves after the timeout.

### `packages/server` — authoritative Colyseus room

- `index.ts` boots `defineServer` with `WebSocketTransport`. **Uses `@colyseus/core` + `@colyseus/ws-transport` directly, never the `colyseus` meta-package** — this is deliberate (see pnpm-workspace `allowBuilds` / `minimumReleaseAgeExclude`).
- `rooms/MorphyRoom.ts` — the whole game. Holds `RoomState`/`PlayerState` (`@colyseus/schema` classes; note `experimentalDecorators` + `useDefineForClassFields: false` in its tsconfig). Owns the round state machine (`lobby → starting → hiding → hunting → round_end`), role assignment, the patch loop, and **server-side hit resolution** (ray vs. prop bounding cylinders + wall AABBs). Every inbound WS payload is validated by a `parse*` helper that returns `null` on bad input (silently ignored, never trusted). Capture is **infection**: a hit prop becomes a hunter and stays in play, so the round ends when no prop is left.
- Maps: **three hand-authored maps**, one builder each (`maps/station.ts`, `maps/mars.ts`, `maps/urban.ts`), registered in `maps/index.ts` as `MAP_BUILDERS` and chosen from the lobby picker. `buildMap(id, seed)` runs on `onCreate` and again when a party host switches map — **not** per round; a fresh seed only reshuffles the seeded variation (tile variants, furniture, scenery) inside the authored layout. `maps/lib.ts` holds the shared grid primitives (`TILE`, wall/floor variants, colliders), `furnish.ts` fills rooms from semantic **archetypes** (mess hall, quarters, control room, storage bay, lab), and `spaceCatalog.ts` / `marsCatalog.ts` / `urbanCatalog.ts` are the per-theme prop catalogs — the shapes players can morph into. Each builder also exports **every model path it can emit for any seed**, which is what the client's production asset allow-list is built from.
- `rooms/botFill.ts` + the bot block in `MorphyRoom.ts` — a quiet **public** room pads itself to `BOT_FILL_TARGET` presences with server-driven bots after `BOT_FILL_DELAY_MS`, and hands a bot's seat back the moment a human joins, so bots never take a slot a player wants nor make the room look fuller to the matchmaker. They hold a synthetic `bot:<n>` session id, are never added or removed mid-round, and their motor output goes through the same `handleInput` / `handleShoot` / `handleReady` entry points a real client's messages do — so a bot has no authority a player lacks. Those handlers take an `Actor` (just `sessionId` + `send`) rather than a Colyseus `Client` for exactly that reason. Private rooms are never filled.
- `stats/repository.ts` — lifetime player stats in SQLite (`node:sqlite`), keyed by an opaque device id the client mints in localStorage and sends both as a join option and as the `x-device-id` header of `GET /stats` (`http.ts`). `config.ts` reads `MORPHY_DB_PATH`, which production sets outside the deploy directory so a redeploy never wipes accumulated stats.

### `packages/client` — Vite + React + react-three-fiber

- `ui/App.tsx` — the shell owning connection state, swapping between menu and game (the game route is `lazy`-loaded behind a `Suspense`). `ui/Lobby.tsx` + `ui/LobbyStage.tsx` are the menu: map / avatar / weapon pickers, name, ready state, party codes, `StatsPane`. `net/connection.ts` wraps the Colyseus SDK `joinOrCreate` / `create` / `joinById` with a timeout.
- `game/Game.tsx` — React HUD and the network event hub: registers all `room.onMessage` handlers and the schema `Callbacks` (player add/remove), drives chat/kill-feed/result/scoreboard overlays.
- `game/Scene.tsx` — the entire 3D scene: map rendering (instanced tiles, fitted GLB props/avatars, scenery), the **local player movement + client-side collision** (walls, obstacles, player separation, gravity/jump), remote-player interpolation, the shooting raycast, and the prop-picker (`E` to morph). This is the largest and densest file.
- `game/audio.ts` — **hybrid audio**: weapon shots / hit impacts (Kenney Sci-fi Sounds, `public/sounds/sci-fi/`) and lobby UI cues (Kenney UI Audio, `public/sounds/ui/`) play cached OGG samples; the lobby loops a licensed theme (`public/sounds/music/lobby-theme.ogg`, own gain, fade in/out); every other cue is synthesized at runtime via the Web Audio API (oscillators + noise bursts). Everything routes through one master gain, so mute covers all; volume / music / UI-sound prefs persist to localStorage (`morphy:*` keys).

### Two facts that span files

**Authority split.** The server is authoritative for the things that matter competitively: phase/timers, roles, HP, alive/dead, and **hit resolution**. Movement is _not_ fully authoritative — the client computes its own position and collision and sends `position + rotation` ~20 Hz; the server only **clamps to map bounds**. Wall/furniture collision exists **only client-side** (`Scene.tsx`). This is an intentional LAN-pragmatic tradeoff, not a bug.

**State propagation has three distinct paths**, all in `Game.tsx`/`Scene.tsx`:

1. `Callbacks.get(room).onAdd/onRemove("players", …)` maintains the live `playersRef` map and the `ids` list.
2. `callbacks.listen(…)` on the room fields (phase, timer, winner…) and on each player's `PLAYER_META_FIELDS` (name, role, alive, hp, kills, propType…) lifts them into React state — schema-driven, not polled, and gated by equality checks to avoid re-renders. The only interval left is a 250 ms local clock tick that re-renders the countdown.
3. `useFrame` reads player positions **directly from `playersRef`** every frame to interpolate meshes — positions never go through React state.

### Assets

GLB models live in `packages/client/public/models/<kit>/`: `blaster` (weapon viewmodels), `pets`
(player avatars), `space/modular` (floor/wall/gate tiles for the station and outpost floorplans),
`space/station` (interior furniture props), `space/exterior` (Martian scenery), `urban` (buildings,
roads, street props). `characters/` is staged but unwired — the planned humanoid avatar set, see
`shared/avatars.ts`. Kenney kits reference an external `Textures/colormap.png` per kit — keep that
file alongside the GLBs or models render untextured.

Only the GLBs on the allow-list in `packages/client/runtimeAssets.ts` reach `dist`: at build start
`runtimeAssetsPlugin` resolves each allow-listed model plus the external buffer/image URIs declared
inside it and **throws if one is missing**, then prunes every other GLB from the output. A broken
model reference fails the build instead of 404-ing in a match.

Audio samples in active use ship from `packages/client/public/sounds/` (`sci-fi/` combat, `ui/` menu cues, `music/` lobby theme — see `music/CREDITS.txt` for the alkakrab license). Unwired candidates are staged in `assets/audio/` (per-directory READMEs and licenses) — copy into `public/sounds/` only when a sound is actually used, so the client bundle stays lean.

## Deploy

Work on a branch and open a pull request. `master` has **no branch protection** — the org is on
GitHub's free plan, which gates that feature (and CODEOWNERS) behind a paid plan for private
repositories — so the PR flow is convention, not enforcement. CI runs on every pull request and on
every push to `master`.

Production ships on a **version tag**, never on a push to a branch:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

That fires two workflows. `release.yml` cuts a GitHub release from the matching `CHANGELOG.md`
section (and fails if the section is missing). `deploy-prod.yml` runs CI, then `deploy.yml` builds
`ghcr.io/${{ github.repository }}:<sha>` — the tagged **commit** sha, so the deployed image is
immutable and independent of the tag — joins the deploy host's tailnet, rsyncs `compose.yml` and
the built client, and runs `docker compose pull && up -d`. `deploy-prod.yml` also accepts a manual
`workflow_dispatch`, for a redeploy without a new tag. The server runs in Docker behind nginx; the
client is static files nginx serves directly.

`deploy/nginx.conf` is a **reference copy that CI does not deploy** — the workflow only ships
`compose.yml` and `dist/`. Changing it means applying it on the host by hand
(`nginx -t && systemctl reload nginx`), so the two drift silently if you forget.

## Conventions

- All user-facing strings are **English**.
- Gameplay constants → `shared/constants.ts`. Rendering/layout constants → module-level `const` at the top of the file that uses them. No inline magic numbers in logic.
- `VITE_SERVER_URL` overrides the server URL on the client (default: same-origin `/colyseus`, proxied by Vite to `:2567`). Server `PORT` env overrides `2567`.
- The Vite dev server proxies `COLYSEUS_PROXY_PATH` (`/colyseus`) to the game server and needs `fs.allow: ["../.."]` to import shared source; `vite.config.ts` imports `shared/src/constants` directly.
