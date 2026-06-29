# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

webhunt.lol is a browser multiplayer prop-hunt game: low-poly 3D, LAN-first, server-authoritative. Hunters stalk players disguised as scene objects (props). See `SPEC.md` for the design intent — but note it has **diverged from the code** (see "Spec vs. code" below); the code is the source of truth.

## Commands

```bash
pnpm install            # Node ≥ 20, pnpm
pnpm dev                # server (Colyseus :2567) + client (Vite :5173) in parallel
pnpm dev:server         # tsx watch — server only
pnpm dev:client         # vite — client only
pnpm typecheck          # tsc --noEmit across all packages (the only static gate)
pnpm tunnel             # ngrok http 5173 — share a LAN/remote session
pnpm --filter @webhunt/client build   # production client bundle
```

There is **no test suite, no linter, and no formatter**. `pnpm typecheck` is the only automated check — run it after changes. Verification beyond that is manual play.

Single-package typecheck: `pnpm --filter @webhunt/server typecheck` (or `@webhunt/client` / `@webhunt/shared`).

## Architecture

pnpm-workspace monorepo, three packages with a strict dependency direction: **client → shared ← server** (client and server never import each other; both depend only on `@webhunt/shared`).

### `packages/shared` — the contract layer
The single source of truth for everything client and server must agree on. **Exports raw TypeScript** (`"exports": { ".": "./src/index.ts" }`, no build step) — both sides consume the source directly via the `@webhunt/shared` workspace alias.
- `constants.ts` — all gameplay tuning (durations, ratios, speeds, ranges, limits). No gameplay magic numbers live anywhere else.
- `protocol.ts` — network message **name constants** (`MSG_INPUT`, `MSG_SHOOT`, …) plus the payload interfaces. Messages are individual Colyseus channels keyed by these string constants, **not** a single tagged union.
- `map.ts` — the `MapDefinition` data model, `parseMapDefinition` (boundary validation, throws `MapValidationError`), and `computePropBounds` (derives a prop's bounding cylinder from its primitive parts — **shared by server hit detection and client mesh fitting**, so they always agree on hitboxes).

### `packages/server` — authoritative Colyseus room
- `index.ts` boots `defineServer` with `WebSocketTransport`. **Uses `@colyseus/core` + `@colyseus/ws-transport` directly, never the `colyseus` meta-package** — this is deliberate (see pnpm-workspace `allowBuilds` / `minimumReleaseAgeExclude`).
- `rooms/WebHuntRoom.ts` — the whole game. Holds `RoomState`/`PlayerState` (`@colyseus/schema` classes; note `experimentalDecorators` + `useDefineForClassFields: false` in its tsconfig). Owns the round state machine (`lobby → starting → hiding → hunting → round_end`), role assignment, the patch loop, and **server-side hit resolution** (ray vs. prop bounding cylinders + wall AABBs). Every inbound WS payload is validated by a `parse*` helper that returns `null` on bad input (silently ignored, never trusted).
- Map generation: **maps are procedurally generated per round**, not loaded from files. `generateMap(seed, catalog)` builds a rooms+corridors grid (modular glTF tiles + matching box colliders), `furnish.ts` fills each room from a set of semantic **archetypes** (mess hall, quarters, control room, storage bay, lab), and `emitScenery` dresses the exterior Martian apron with space-kit set pieces. `spaceCatalog.ts` is the hardcoded prop catalog (the shapes players can morph into); `avatars.ts` assigns a random cube-pet model per player. A fresh seed is generated each round in `beginHiding`.

### `packages/client` — Vite + React + react-three-fiber
- `ui/App.tsx` — lobby/connect screen; `net/connection.ts` wraps the Colyseus SDK `joinOrCreate` with a timeout.
- `game/Game.tsx` — React HUD and the network event hub: registers all `room.onMessage` handlers and the schema `Callbacks` (player add/remove), drives chat/kill-feed/result/scoreboard overlays.
- `game/Scene.tsx` — the entire 3D scene: map rendering (instanced tiles, fitted GLB props/avatars, scenery), the **local player movement + client-side collision** (walls, obstacles, player separation, gravity/jump), remote-player interpolation, the shooting raycast, and the prop-picker (`E` to morph). This is the largest and densest file.
- `game/audio.ts` — **all sound is synthesized at runtime via the Web Audio API** (oscillators + noise bursts); there are no audio asset files.

### Two facts that span files

**Authority split.** The server is authoritative for the things that matter competitively: phase/timers, roles, HP, alive/dead, and **hit resolution**. Movement is *not* fully authoritative — the client computes its own position and collision and sends `position + rotation` ~20 Hz; the server only **clamps to map bounds**. Wall/furniture collision exists **only client-side** (`Scene.tsx`). This is an intentional LAN-pragmatic tradeoff, not a bug.

**State propagation has three distinct paths**, all in `Game.tsx`/`Scene.tsx`:
1. `Callbacks.get(room).onAdd/onRemove("players", …)` maintains the live `playersRef` map and the `ids` list.
2. A 200 ms **poll** of `room.state` lifts phase/timer/winner and per-player meta (name, role, hp, kills…) into React state, gated by equality checks to avoid re-renders.
3. `useFrame` reads player positions **directly from `playersRef`** every frame to interpolate meshes — positions never go through React state.

### Assets
GLB models live in `packages/client/public/models/<kit>/`: `blaster` (weapon viewmodel), `pets` (player avatars), `space` (corridor/wall/floor tiles for the generated map), `space-station` (interior furniture props), `space-kit` (exterior scenery). Kenney kits reference an external `Textures/colormap.png` per kit — keep that file alongside the GLBs or models render untextured.

## Spec vs. code

`SPEC.md` is the original design doc and is **partially outdated**. Where it conflicts with code, trust the code. Notable divergences:
- **Maps are procedural** (`generateMap.ts`, space-station theme), not a file-based `office-min.json`. There is no `maps/` directory.
- **Capture = infection**: a hit prop is converted to a hunter (stays in play), not turned into a spectator. The round ends when no props remain.
- The protocol is per-message `MSG_*` constants, not the `{ t: 'ready' }` tagged union shown in the spec.
- `MapDefinition` has gained `tiles` and `scenery` fields beyond the spec's listing.

## Conventions

- All user-facing strings are **English**.
- Gameplay constants → `shared/constants.ts`. Rendering/layout constants → module-level `const` at the top of the file that uses them. No inline magic numbers in logic.
- `VITE_SERVER_URL` overrides the server URL on the client (default: same-origin `/colyseus`, proxied by Vite to `:2567`). Server `PORT` env overrides `2567`.
- The Vite dev server proxies `COLYSEUS_PROXY_PATH` (`/colyseus`) to the game server and needs `fs.allow: ["../.."]` to import shared source; `vite.config.ts` imports `shared/src/constants` directly.
