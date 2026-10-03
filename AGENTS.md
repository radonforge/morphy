# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Morphy is a browser multiplayer prop-hunt game: low-poly 3D, LAN-first, server-authoritative. Hunters stalk players disguised as scene objects (props). The code is the source of truth.

**Scope decision (2026-09-08): multiplayer-first.** The game is for humans playing each other; bots exist only to fill the gap when a room is thin, and they play by the same information rules a player has. Playing *with* agents as a feature (an LLM-driven policy, a UI to spawn agents into your room) is deliberately deferred (issues #7 and #8), so do not add machinery whose only purpose is that direction.

## Commands

```bash
pnpm install            # Node ≥ 24, pnpm 11 (the version is pinned in package.json)
pnpm dev                # server (Colyseus :2567) + client (Vite :5173) in parallel
pnpm dev:server         # tsx watch, server only
pnpm dev:client         # vite, client only
pnpm bot                # headless bots against a running server, see packages/bot/README.md
pnpm typecheck          # tsc --noEmit across all packages
pnpm check              # Biome lint + format (also: check:write, format, lint)
pnpm test               # node:test suite under tests/
pnpm check:ci           # the non-mutating Biome gate CI runs
pnpm level check        # layout findings for the station document; see "packages/level" below
pnpm tunnel             # ngrok http 5173, share a LAN/remote session
pnpm --filter @morphy/client build   # production client bundle
```

CI (`.github/workflows/ci.yml`) runs `pnpm check:ci`, `pnpm typecheck`, `pnpm test` and a production
client build on every pull request; run the same four locally after changes. The suite in
`tests/` is plain `node:test` over the real modules (validators, map builders, geometry, storage,
HTTP endpoints, bot scheduling, room lifecycle, client movement and controls); there is no mocking
framework and no browser test. Verification beyond that is manual play.

Single-package typecheck: `pnpm --filter @morphy/server typecheck` (or `@morphy/client` / `@morphy/shared` / `@morphy/level`).

## Architecture

pnpm-workspace monorepo, five packages with a strict runtime dependency direction:
**client → shared ← server**, plus **server → level → shared**, **client → level**, **bot → shared**
and **server → bot/brain** (client and server still never import each other at runtime).
`client → level` exists for the dev-only map editor, which compiles the document it edits on every
change, and for `pickDeckLights`, the one thing the production client (`DeckLights` in `Scene.tsx`)
imports from it; `@morphy/level` is pure, so the rest tree-shakes out of the bundle.

`server → bot` exists so the room-filling bots and the CLI bots run the *same* behaviour instead of
two copies that drift. It is confined to the `@morphy/bot/brain` entry point: the package's
`exports` map deliberately splits the transport-free half (`driver.ts`, `reflex.ts`, `view.ts`,
`nav/`, `policy/`) from `bot.ts`, the only module that touches `@colyseus/sdk`. Import
`@morphy/bot/brain` from the server, never `@morphy/bot`, or the SDK lands in the server's graph.

The other deliberate exception is build-time: `packages/client/runtimeAssets.ts` imports the map
builders and prop catalogs from `../server/src/…` and the floorplan tile paths from `../level/src`,
so the production GLB allow-list is derived from the same data the server emits. Nothing of it
reaches the browser: the Vite plugin consuming it is `apply: "build"`. The level bridge
(`packages/client/viteLevelBridge.ts`) does the same at dev time for the editor: it imports the
server's prop catalogs in Node and is `apply: "serve"`.

### `packages/shared`: the contract layer

The single source of truth for everything client and server must agree on. **Exports raw TypeScript** (`"exports": { ".": "./src/index.ts" }`, no build step); both sides consume the source directly via the `@morphy/shared` workspace alias.

- `constants.ts`: all gameplay tuning (durations, ratios, speeds, ranges, limits). No gameplay magic numbers live anywhere else.
- `protocol.ts`: network message **name constants** (`MSG_INPUT`, `MSG_SHOOT`, …) plus the payload interfaces. Messages are individual Colyseus channels keyed by these string constants, **not** a single tagged union.
- `map.ts`: the `MapDefinition` data model (its `spawnPoints` split into `props`, where everyone waits for a round, and `hunters`, where hunters are released as the hunt opens and respawn), `parseMapDefinition` (boundary validation, throws `MapValidationError`; the optional `lights` a night map carries are validated when present and left off when absent, which is urban), and `computePropBounds` (derives a prop's bounding cylinder from its primitive parts, **shared by server hit detection and client mesh fitting**, so they always agree on hitboxes).
- `maps.ts`: `MAP_CATALOG` (the two selectable maps and their lobby metadata: name, theme, `tag`, blurb), `MapId`, `isMapId`, and `DEFAULT_MAP_ID` (North District, the first-run pick). The client renders the picker straight from it; the server keys `MAP_BUILDERS` on the same ids as a `Record<MapId, …>`, so a half-added map fails `typecheck`. Adding a map is one entry here plus four `Record<MapId, …>` the compiler then demands: the builder (`server/maps/index.ts`), `MAP_CHROME` and `MAP_GLASS` / `MAP_THEME_BASE` (`client/theme.ts`), `STAGE_THEMES` (`client/ui/LobbyStage.tsx`) and a lobby diorama (`client/ui/lobbyDioramas.ts`, ~20 hand-placed set pieces and the only part with no compiler to catch a bad job). Editorial copy belongs here; CSS accents and glyphs belong in `MAP_CHROME`, never in this package.
- `weapons.ts`, `avatars.ts`: the selectable weapon and avatar catalogs, same catalog-plus-validator shape.
- `party.ts`: private-room codes over a look-alike-free alphabet; the code **is** the Colyseus roomId, so joining a party is a plain `joinById(code)`.
- `agent.ts`: the two-level `Intent` / `Observation` contract shared by server and bot. **Types only**: both sides run in one process, so nothing here is serialised and there are no validators. The `parseIntent` / `parseObservation` guards it used to carry existed for an out-of-process policy that was never built; they were removed, not kept warm (git history has them).
- `geometry.ts`: `rayAabb` and friends, shared by server hit resolution and the bot's hit prediction.
- `async.ts`: `withTimeout`, which forces callers to dispose a value that resolves after the timeout.
- `random.ts`: `makeRng`, the seeded mulberry32 PRNG behind every map's seeded variation.
- `modelFit.ts`: `uniformFitScale`, the uniform scale that seats a GLB in its prop's bounding
  cylinder; the client's `fitModel` and the level checks both call it, so they never disagree.
- `assetTags.ts`: `ASSET_TAGS`, what geometry cannot settle about each catalog prop's model: its
  front, its symmetry (how many quarter turns leave it looking the same: 1, 2 or 4) and its mount
  (floor, wall, surface), each marked `auto` (a proposal the owner kept on review) or `human`. A
  typed literal, not JSON, so the compiler checks every value and the production bundle drops it; a new
  catalog prop fails `tests/asset-cards.test.mjs` until it is tagged.

### `packages/level`: the level document

Raw TypeScript like `@morphy/shared` and depending only on it: it must never import server or
client code, three.js or Colyseus.

- `document.ts`: `LevelDocument`, a map as a document of intents on the `TILE` grid (rooms as cell
  rects, doors on grid edges, placed catalog objects, spawn points, optional night `lights`), and `parseLevelDocument(input,
  { catalog, id? })`, the file boundary: it throws `LevelValidationError` naming the document, the
  offending entity and a fix hint (a different map id than asked for, overlapping rooms, duplicate
  ids, unknown types, a door with the same region on both sides or in the outer wall, anything
  outside the map, a light inside a wall).
- `compile.ts`: `compileLevel(doc, { catalog, seed })` → `MapDefinition`. **Positions in a document
  are fixed**: the seed only picks floor and wall tile variants, so a document-authored map has the
  same furniture every round by design, and the same lights (`MapDefinition.lights` is the
  document's, copied).
- `floorplan.ts`: `emitFloorplan`, turning a region grid and its doors into floor tiles, wall tiles,
  wall colliders and gates (which keep `gate.glb`: the bot finds doorways by that name), plus
  `doorKey` (the `axis:line:cell` identity parser and emitter share) and `FLOORPLAN_MODEL_PATHS`.
- `checks.ts`: `validateLevel(doc, { catalog, cards })` → `LevelReport` (`findings`, `unplaced`,
  `metrics`), the spatial translator an agent edits by instead of screenshots. Objects are measured
  by their **real rendered footprint** (`footprint.ts`: the GLB's asset card through
  `uniformFitScale`, the same arithmetic the client's `fitModel` delegates to); passage, doorways
  and spawns by the per-part collision boxes, rotated with the object, that the client moves
  against (they always contain the footprint), less the parts no taller than `LEVEL_STEP_HEIGHT`,
  which a body steps onto. Shapes whose vertical spans do not meet never overlap. Codes are listed
  in `FINDING_CODES`; thresholds are the `LEVEL_*` constants in `shared/constants.ts`.
  Reachability floods a `LEVEL_SAMPLE_CELL` grid from the hunter spawns with the client's body
  radius, so a pocket under `LEVEL_UNREACHABLE_MIN_AREA` is sampling noise and is not reported, and
  is skipped (the spawns are reported instead) when no hunter spawn is walkable. The station's
  corridor spine and its two 24 m stores still fail `LEVEL_SIGHTLINE_MAX`; that is layout work
  still to do, so do not raise it to quiet them. Validators never move or drop an object. Tests that
  need a stable document read `tests/fixtures/station-seven-rooms.level.json`, the station before
  its rooms were split, so editing the map does not break them.
- `ops.ts`: pure edits returning `{ doc, findings, ok }` (place by `at` / `center` / `againstWall` /
  `nextTo` / `row`, move, rotate, remove, duplicate, room add / resize / remove, door toggle).
  Positions snap to 0.5 m and yaw to quarter turns unless `free` (a rounded yaw is reported as
  `op.yaw-snapped`; a duplicate keeps its source's exact yaw); N is -Z, and `againstWall` turns
  the model's tagged front, not its +Z, into the room.
  An op that would collide, or place on open ground or across a room's edge, returns an
  `op.blocked` error naming the blocker and the input document unchanged; a move or turn is
  refused only for what the object did not already touch.
- `lights.ts`: `pickDeckLights(map, roomCount)`, the pure k-means pick of a night map's point lights
  (one per furniture cluster pushed clear of the walls, one per hunter spawn), kept here so the
  client, the editor and the CLI propose lights with the same algorithm, and `deckLightsFor`, what
  the client hangs: the map's own `lights` when it has any (an empty list means none), else the pick.
  Kepler-9's document was seeded with exactly the pick it used to get on the client, so the night
  looks the same; from there the lights are edited, not generated. Kinds stay `room` and
  `corridor`, the theme preset (`DeckLightPreset` in `Scene.tsx`) owns colour, intensity and reach.
  `lightOps.ts`: `addLight` / `moveLight` / `removeLight` / `proposeLights` (replaces the lights
  with the pick), snapped to 0.5 m unless `free`, refused in a wall or off the map; a room or door
  edit that would raise a wall over a light is refused too, since the parser would reject the
  result. `checks.ts` reports a room light nearer a wall than `DECK_LIGHT_WALL_CLEARANCE`
  (`light.wall-clearance`, corridor lights are exempt: they hang where the hunters stand).
- `overlays.ts`: `levelOverlays`, the geometry behind `floor.unreachable` and `room.sightline`
  (unreached walkable samples, each room's longest sightline) for the editor to draw, built from
  the same sampling as `validateLevel` so an overlay never disagrees with a finding.
- `views.ts` / `serialize.ts`: the text an agent reads (summary, 0.5 m ASCII room plan, one line
  per finding, report delta) and `formatLevelDocument`, which writes JSON in the layout Biome
  leaves alone, so a CLI edit passes `check:ci` as is.
- `tools/level/cli.ts` is `pnpm level` (`view`, `list`, `check`, `place`, `move`, `rotate`,
  `remove`, `duplicate`, `room add|resize|remove`, `door toggle`, `light list|add|move|remove|propose`,
  `--file` for another copy): every
  write re-parses, validates, writes atomically and prints the report delta. `check` exits 1 while
  any finding is an error, so a script can gate on it; `--help` lists the exit codes. Negative
  option values need the `=` form (`--by=-0.5,0`), a `node:util` `parseArgs` rule.

### `packages/server`: authoritative Colyseus room

- `index.ts` boots `defineServer` with `WebSocketTransport`. **Uses `@colyseus/core` + `@colyseus/ws-transport` directly, never the `colyseus` meta-package**: this is deliberate (see pnpm-workspace `allowBuilds` / `minimumReleaseAgeExclude`). Matchmaking is `filterBy(["map"]).sortBy({ clients: -1 })`: quick play joins the busiest room **on the map the player picked**, and opens one there when none exists, so a lobby pick is binding instead of a hint. The filter was deliberately absent until 2026-09-17, on the grounds that it splits a small pool by map, reversed because `botFill.ts` now pads a thin public room to `BOT_FILL_TARGET` within `BOT_FILL_DELAY_MS`, so the empty-room outcome it guarded against no longer happens. Do not re-remove it without also removing bot fill. `map` is a required field of `PublicJoinOptions` and the CLI bot sends it too, which is load-bearing: a caller that omits it is filtered into its own partition of rooms whose stored `map` is `undefined`, and would never meet a player. Private rooms are unaffected (`create` / `joinById` bypass matchmaking entirely), and a public room's map never changes after `onCreate` (`handleSetMap` returns early unless `isPrivate`), so the value the filter stored cannot go stale.
- `rooms/MorphyRoom.ts`: the whole game. Holds `RoomState`/`PlayerState` (`@colyseus/schema` classes; note `experimentalDecorators` + `useDefineForClassFields: false` in its tsconfig). Owns the round state machine (`lobby → starting → hiding → hunting → round_end`), role assignment, the patch loop, and **server-side hit resolution** (ray vs. prop bounding cylinders + wall AABBs). Every inbound WS payload is validated by a `parse*` helper that returns `null` on bad input (silently ignored, never trusted). Capture is **infection**: a hit prop becomes a hunter and stays in play, so the round ends when no prop is left. Nobody spectates either: a hunter whose misses run its HP out respawns after `HUNTER_RESPAWN_MS` at `CONVERTED_HUNTER_HP`, on the spawn point furthest from the live props, so props win on the clock (or at once if every hunter walks out), never because the hunters ran dry. A public room with enough players goes from `round_end` straight into the next `starting` (`afterRound`): the Ready lobby is only where a room first gathers, or falls back to when it runs thin, and a private room still returns to its lobby for the host. Joins are accepted between rounds (`lobby`, `starting`, `round_end`), and the room locks as roles are dealt in `beginHiding`, not when the countdown starts, so a player arriving at a result card is dealt into the next round instead of opening an empty room. A prop taunts for points with `F` (`MSG_TAUNT_REQUEST`): a per-round `score` shown in the standings and never persisted, more with a hunter close by; one that has not taunted for `TAUNT_INTERVAL_MS` is made to, for nothing, on a clock staggered per prop so forced taunts never fire in unison. A hunter's `F` is a sonar (`MSG_SONAR`): every live prop within `SONAR_RADIUS` honks as a forced taunt, decoys stay silent (the hunter's answer to them), and the pulse itself is broadcast (`MSG_SONAR_PING`) so props hear a hunter close by.
- Maps: **two hand-authored maps**, one builder each (`maps/urban.ts`, `maps/station.ts`), registered in `maps/index.ts` as `MAP_BUILDERS` and chosen from the lobby picker. `buildMap(id, seed)` runs on `onCreate` and again when a party host switches map, **not** per round; a fresh seed only reshuffles the seeded variation inside the authored layout (urban: tile variants, buildings, street props; station: tile variants only). Kepler-9 is a level document, `maps/station.level.json`, parsed through `parseLevelDocument` when the map registry loads and compiled by `compileLevel`; its furniture was converted once from the retired archetype furnisher at seed 1 and is now edited in the document, not generated. Urban is still a procedural builder (`maps/lib.ts` holds its `pick` / `randRange`), and `spaceCatalog.ts` / `urbanCatalog.ts` are the per-theme prop catalogs: the shapes players can morph into. A third map, Ares Outpost (`mars`), was cut on 2026-09-25: open ground with long sightlines is the opposite of what a prop hunt needs, and two maps split the small player pool less than three. Each builder also authors hunter spawns away from the prop spawns (urban on its crossroads, station along the corridor spine), and `beginHunting` teleports each hunter to the one furthest from every live prop, because everyone waits out the hide where the round dealt them and a hunter released beside a new player caught them within seconds. The client's production asset allow-list is built from **every model path a map can emit for any seed**: urban exports its own (`URBAN_SCENERY_MODEL_PATHS`), the station's tiles are `FLOORPLAN_MODEL_PATHS` from `@morphy/level`, and both maps' props are their catalog models.
- `rooms/roomErrors.ts` + `MorphyRoom.onUncaughtException`: Colyseus wraps a room's `clock` callbacks and `onMessage` handlers in a try/catch **only if the room defines `onUncaughtException`** (`Room.mjs` gates the wrapping on it), and `@colyseus/clock` has no guard of its own. `index.ts` also asks for no graceful shutdown, so Colyseus installs no process-level net underneath. Without the hook a throw takes down the whole Node process and every other room on it, measured both ways, for an interval or phase timer (`sendPings` runs every 2 s in every room) and for a message handler reached by a bad payload. Do not remove it. The formatter exists because these exception objects carry the input that caused them (`OnMessageException.payload` is the raw client message, `OnJoinException.options` holds the device id), so the log gets the method, message type, truncated session id and error only, never the payload.
- `rooms/botFill.ts` + the bot block in `MorphyRoom.ts`: a quiet **public** room pads itself to `BOT_FILL_TARGET` presences with server-driven bots after `BOT_FILL_DELAY_MS`, and hands a bot's seat back the moment a human joins, so bots never take a slot a player wants nor make the room look fuller to the matchmaker. They hold a synthetic `bot:<n>` session id, are never added or removed mid-round, and their motor output goes through the same `handleInput` / `handleShoot` / `handleReady` entry points a real client's messages do, so a bot has no authority a player lacks. They also get no *information* a player lacks: `addBot` runs them with `visibility: "limited"`, so a bot hunter has to find a prop by line of sight, movement and shape instead of reading `role` off it. Shape is `ObservedEntity.disguised` (whether a contact wears a disguise at all, never which one), and it is deliberately in the limited view because a player reads it off the screen: an undisguised contact renders as a character with a weapon, so it can only be a hunter. Without it a hunter bot could not tell a teammate from a disguise that happened to be moving, and hunters pooled into a pack that stared at each other for the round (fixed 2026-09-09). **It is absent whenever the contact is out of line of sight**, because footsteps through a wall tell a player nothing about shape: a heard contact is "might be anyone", so a bot still searches a noise instead of writing it off as a teammate. Keep that gate: it is the whole reason the field is fair. `disguised: true` alone never marks a player, because a hunter is shown every **scene prop** in sight as well, and a decoy in sight, each listed exactly as a disguised player standing still (same fields, opaque handles dealt nearest first from one sequence, never session ids). Until 2026-09-25 the list held players only, so any disguise in sight was a prop by construction and bot hunters shot it on sight: they won every round, with a median hunt of 4 s. A disguise becomes a *suspect* only on a tell a player would see, `ObservedEntity.tellRecently`: seen moving or spinning, seen changing shape, or seen honking, within `BOT_TELL_WINDOW_MS`. Without a suspect the hunter *probes*: at most every `BOT_PROBE_INTERVAL_*_MS` (by difficulty, `ObservedSelf.canProbeNow`) it shoots the nearest object in reach it has not tested yet, and pays the same miss damage a player does when that was furniture (halved on a decoy). A hunter bot also perceives nothing during `hiding`, since a human hunter sits behind a blindout card, and its movement samples are dropped as the round begins, so no prop reads as "seen moving" for the walk to its spot. A bot prop holds still while a hunter can see it, since moving is the tell, and bolts only from one within `PANIC_SEEN_RADIUS` or one it merely hears, dropping a decoy as it breaks cover. A bot hears what a player's client plays positionally the same way: a sound in `Observation.sounds` with a position (exact in sight, snapped otherwise) and no source. Bots are not clients, so the room hands each broadcast sound to them itself (`letBotsHear`); forget that and a new sound reaches every human and no bot. `"full"` reads ground truth and is a measuring anchor, not a way to play; do not wire it into a live room. Those handlers take an `Actor` (just `sessionId` + `send`) rather than a Colyseus `Client` for exactly that reason. Private rooms are never filled.
- `MorphyRoom.onDrop` / `onReconnect`: a dropped connection holds its seat for `RECONNECT_WINDOW_MS` instead of leaving the round: the player stays in `state.players` with `connected = false`, keeps role and position, and rejoins on the same session id **without passing through `onJoin`**, so neither the in-progress guard there nor a running round's `lock()` shuts them out. Colyseus runs `onLeave` itself when the window lapses, so every existing cleanup and award path still runs, just later. A lobby seat is handed straight back: there is nothing to come back to. Consequence to keep in mind: a held seat is *present in the room but not in the game*, hence `presentCount()` for start thresholds, `firstPresentHumanId()` for the abort award, and `assignRoles` dealing absent players out of the round.
- `stats/repository.ts`: lifetime player stats in SQLite (`node:sqlite`), keyed by an opaque device id the client mints in localStorage and sends both as a join option and as the `x-device-id` header of `GET /stats` (`http.ts`). `config.ts` reads `MORPHY_DB_PATH`, which production sets outside the deploy directory so a redeploy never wipes accumulated stats.

### `packages/client`: Vite + React + react-three-fiber

- `ui/App.tsx`: the shell owning connection state, swapping between menu and game (the game route is `lazy`-loaded behind a `Suspense`). `ui/Lobby.tsx` + `ui/LobbyStage.tsx` are the menu: name, ready state, party codes, `StatsPane`, and **two carousels on the stage itself**: the avatar is chosen by morphing through the catalog, and the map by morphing the whole diorama around it, neither from a grid or a strip. Both run off one set of parts (`ui/CarouselRail.tsx`, `ui/carousel.ts`, `ui/carouselWheel.ts`, `ui/useCarouselInput.ts`) and are a single `PickerId` apart, so the cost of either picker is flat in catalog size; the strip of one card per map it replaced hid its own overflow past about five maps. `carouselWheel.ts` is where the reasoning about trackpad inertia lives, and it is a pure fold under test; do not reinline it into a component. **The callsign is inside the avatar picker**, not in a menu of its own: naming yourself and picking a shape are one decision, so the Identity pane that held them separately was removed (2026-09-17) once the only other thing in it was a third button opening this same picker. The name commits on blur and on picker close, the avatar per step, and `useCarouselInput` ignores arrows while the field has focus. The opener is the chip over your avatar, which is why `LobbyStage` portals it out of `.menu-canvas`: that subtree is `aria-hidden` for the 3D scene, and it was the only keyboard path left. The weapon picker is in-game, not here (`game/Game.tsx`). `net/connection.ts` wraps the Colyseus SDK `joinOrCreate` / `create` / `joinById` with a timeout.
- `game/Game.tsx`: React HUD and the network event hub: registers all `room.onMessage` handlers and the schema `Callbacks` (player add/remove), drives chat/kill-feed/result/scoreboard overlays.
- `game/Scene.tsx`: the entire 3D scene: map rendering (instanced tiles, fitted GLB props/avatars, scenery), remote-player interpolation, the shooting raycast, pointer-lock mouse look, and the per-frame drive of the local player through `movement.ts`. Still the densest file in the client. **There is no prop picker**: a prop presses `R` to send `MSG_REROLL` and the *server* swaps in a random different prop from the map catalog, spending one of a bounded `rerollsLeft`. `Q`/`E` are prop-only and spin the disguise in place (`propRot` at `PROP_TURN_SPEED`), not the camera; aim is mouse-look alone. Do not re-add a picker believing one was lost.
- `game/movement.ts`: the **client-side movement + collision core**, lifted out of `Scene.tsx` so it is testable without a browser: `advanceMovement` (accel/decel, air control, gravity, jump buffering), `resolveColliders` (walls, obstacles, step-up, player separation), `supportHeightAt`, `clampToBounds` and `cappedFrameSeconds`, which bounds the frame a backgrounded tab would otherwise integrate in one step.
- `game/useControls.ts`: the key-code → action map plus `movementFromHeld`, which projects held codes onto actions so aliases (W / ArrowUp, either Shift) read as one, and releases everything when the window blurs. `game/Controls.tsx` renders the in-game legend and the controls dialog from the same key names, so a rebind that misses one of the two shows the player the wrong key.
- `game/pointerLock.ts`: `lockPointer`, the only path to `requestPointerLock`. The browser refuses the lock routinely (too soon after an exit, no fresh gesture) and the refusal is a promise rejection, so both callers go through here rather than leaking an `Uncaught (in promise)`.
- `editor/`: the **dev-only map editor**, opened at `#editor` (or `#editor/<mapId>`) on the Vite dev
  server. `main.tsx` lazy-loads it behind `import.meta.env.DEV`, so the production bundle carries
  none of it (a build adds ~100 bytes for the gate and `App`'s `tryMap`; grep `dist` for
  `__morphy/levels` to confirm). It needs no game server: `viteLevelBridge.ts` serves
  `GET`/`PUT /__morphy/levels/<mapId>` (validated by `parseLevelDocument`, written atomically
  through `formatLevelDocument`) and `GET /__morphy/levels/<mapId>/catalog`, answering only unrelayed
  loopback requests (the dev server is on the LAN and behind `pnpm tunnel`), and pushes a
  `morphy:level-changed` HMR event when the file changes on disk from anywhere else, which the
  page applies as an undoable step labelled External with its entities highlighted (with a
  warning when that replaced unsaved edits, which Undo brings back). Add a map to `levelSources`
  there to make it editable. The bridge reads the prop catalogs once, when Vite starts, so a
  catalog edit (`spaceCatalog.ts` and friends) needs a dev server restart before the editor sees
  it. It also checks that `Host` is localhost or a loopback IP on the dev port and that a `PUT`'s
  `Origin`, when present, is the dev origin, and answers 408 to a body slower than
  `BRIDGE_LIMITS.bodyTimeoutMs`; its atomic-write temp files are gitignored. The plan is an orthographic top-down view drawn by the
  game's own renderers (`MapView`, `DeckLights`, `themeFor` from `game/Scene.tsx`); `Tab` swaps to
  an orbit view. **Every edit an op exists for goes through the `@morphy/level` op** (place, move,
  rotate, duplicate, remove, against-wall placement, room add / resize / remove, door toggle, light
  add / move / remove / propose), so the
  editor and `pnpm level` apply the same snapping and blocking rules; a refused op shows its
  `op.blocked` message, naming the blocker, as a toast. The **Lights tool** (`L`) adds a room light on
  click (Shift for a corridor light), drags and deletes lights, draws each light's reach (the theme
  preset's `distance`) in plan view and offers **Propose lights**, which replaces them with the
  `pickDeckLights` proposal as one undoable step; a light's kind is the one edit with no op
  (`setLightKind` in `edits.ts`). `edits.ts` holds only what no op covers
  (an extra rect of an L, deleting one, spawns, picking) and the op adapters. The checks panel runs
  `validateLevel` with `ASSET_CARDS` on every committed step and groups findings by severity;
  clicking one selects its entity and pans to it, and the unreachable-floor, sightline and
  unique-type overlays are toggles. The pure parts (`edits.ts`, `history.ts`) are tested in
  `tests/editor.test.mjs`.
  **Try it** saves, waits for `tsx watch` to restart the game server (a document write always
  restarts it, since the server imports the JSON), and opens `App` with `tryMap`, i.e. a private
  room on that map; a private room needs a second player to start, so a dev-only card over the room
  (`TryHint.tsx`) spells out `pnpm bot -- --code <party code> -n 1` and offers Back to editor.
- `game/audio.ts`: **hybrid audio**: weapon shots / hit impacts (Kenney Sci-fi Sounds, `public/sounds/sci-fi/`) and lobby UI cues (Kenney UI Audio, `public/sounds/ui/`) play cached OGG samples; the lobby loops a licensed theme (`public/sounds/music/lobby-theme.ogg`, own gain, fade in/out); every other cue is synthesized at runtime via the Web Audio API (oscillators + noise bursts). Everything routes through one master gain, so mute covers all; volume / music / UI-sound prefs persist to localStorage (`morphy:*` keys). Positional cues (taunts, sonar, prop rustles) pan by the camera's facing through `spatialAudio.ts`; a remote prop on the move rustles (`PropFootsteps.tsx`) out to `FOOTSTEP_HEARING_RADIUS`, the very radius a bot hears a mover at, so keep the two on the one constant.

### Two facts that span files

**Authority split.** The server is authoritative for the things that matter competitively: phase/timers, roles, HP, alive/dead, and **hit resolution**. Movement is _not_ fully authoritative: the client computes its own position and collision and sends `position + rotation` ~20 Hz; the server only **clamps to map bounds**. Wall/furniture collision exists **only client-side** (`movement.ts`, driven from `Scene.tsx`). This is an intentional LAN-pragmatic tradeoff, not a bug.

**The disguise is visual only, and that is accepted.** `PlayerState` broadcasts `role`, `propType`
and `x`/`y`/`z` to every client as plain `@type` fields, and there is no `@view`/`StateView` filtering
anywhere, so anyone with devtools open can read which scene object is a player and where. Roles are
public by design already (`StandingsTable` renders a Role column, and `Tab` opens the scoreboard
mid-round); the part that leaks is *which crate is whom*.

Hiding it properly means interest management: adding and removing props from each hunter's
`StateView` as line of sight changes, so the position never reaches a client that should not have it.
`@colyseus/schema` ships `view()` and `StateView`, so no dependency is missing; what stops it is the
cost. It is a design pass over `Scene.tsx`, the densest file in the client, and its failure mode is
**popping**: a crate materialising as you round a corner, visible to every honest player. Trading felt
gameplay against a devtools cheat nobody has run is the wrong trade at this player count, so the
tradeoff stands (decided 2026-09-08, closing #26). Revisit when the game is actually public and the
threat is real, not before. Do not re-file this as a bug.

**State propagation has three distinct paths**, all in `Game.tsx`/`Scene.tsx`:

1. `Callbacks.get(room).onAdd/onRemove("players", …)` maintains the live `playersRef` map and the `ids` list.
2. `callbacks.listen(…)` on the room fields (phase, timer, winner…) and on each player's `PLAYER_META_FIELDS` (name, role, alive, hp, kills, propType…) lifts them into React state, schema-driven, not polled, and gated by equality checks to avoid re-renders. The only interval left is a 250 ms local clock tick that re-renders the countdown.
3. `useFrame` reads player positions **directly from `playersRef`** every frame to interpolate meshes; positions never go through React state.

### Assets

GLB models live in `packages/client/public/models/<kit>/`: `blaster` (weapon viewmodels), `pets`
(player avatars), `space/modular` (floor/wall/gate tiles for the station floorplan),
`space/station` (interior furniture props), `space/exterior` (barrels, machines and desks in the
station catalog; the rest of the kit is unused since the Mars map was cut), `urban` (buildings,
roads, street props). Kenney kits reference an external `Textures/colormap.png` per kit; keep that
file alongside the GLBs or models render untextured.

**Every shipped GLB is static, and `FittedModel` (`client/game/Scene.tsx`) depends on it**: it
clones with `scene.clone(true)`, which `SkinnedMesh.copy` implements by copying `skeleton` *by
reference*, so a cloned skinned mesh stays bound to the cached template's bones and renders
nowhere. The Kenney `characters/` kit was the one skinned kit in the tree and shipped twelve
pedestrians as North District's dominant prop; none of them were ever visible, and a reroll into
one (12 of 19 catalog entries) left the player invisible. The kit was deleted on 2026-09-17 rather
than fixed, because a prop hunt wants scenery for a disguise, not a person. Adding a skinned kit
means switching `FittedModel` to `SkeletonUtils.clone()` first.

Only the GLBs on the allow-list in `packages/client/runtimeAssets.ts` reach `dist`: at build start
`runtimeAssetsPlugin` resolves each allow-listed model plus the external buffer/image URIs declared
inside it and **throws if one is missing**, then prunes every other GLB from the output. A broken
model reference fails the build instead of 404-ing in a match.

Audio samples in active use ship from `packages/client/public/sounds/` (`sci-fi/` combat, `ui/` menu cues, `music/` lobby theme; see `music/CREDITS.txt` for the alkakrab license). Unwired candidates are staged in `assets/audio/` (per-directory READMEs and licenses). Copy into `public/sounds/` only when a sound is actually used, so the client bundle stays lean.

## Deploy

Work on a branch and open a pull request. `master` has **no branch protection**: the org is on
GitHub's free plan, which gates that feature (and CODEOWNERS) behind a paid plan for private
repositories, so the PR flow is convention, not enforcement. CI runs on every pull request and on
every push to `master`.

Production ships on a **version tag**, never on a push to a branch:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

That fires two workflows. `release.yml` cuts a GitHub release from the matching `CHANGELOG.md`
section (and fails if the section is missing). `deploy-prod.yml` runs CI, then `deploy.yml` builds
`ghcr.io/${{ github.repository }}:<sha>` (the tagged **commit** sha, so the deployed image
is immutable and independent of the tag), joins the deploy host's tailnet, rsyncs `compose.yml` and
the built client, and runs `docker compose pull && up -d`. `deploy-prod.yml` also accepts a manual
`workflow_dispatch`, for a redeploy without a new tag. The server runs in Docker behind nginx; the
client is static files nginx serves directly.

`deploy/nginx.conf` is a **reference copy that CI does not deploy**: the workflow only ships
`compose.yml` and `dist/`. Changing it means applying it on the host by hand
(`nginx -t && systemctl reload nginx`), so the two drift silently if you forget.

## Conventions

- All user-facing strings are **English**.
- Gameplay constants → `shared/constants.ts`. Rendering/layout constants → module-level `const` at the top of the file that uses them. No inline magic numbers in logic.
- `VITE_SERVER_URL` overrides the server URL on the client (default: same-origin `/colyseus`, proxied by Vite to `:2567`). Server `PORT` env overrides `2567`, and the Vite dev proxy follows it, so `PORT=2600 pnpm dev:server` beside `PORT=2600 pnpm dev:client --port 5190 --strictPort` runs a second stack next to the first.
- The Vite dev server proxies `COLYSEUS_PROXY_PATH` (`/colyseus`) to the game server and needs `fs.allow: ["../.."]` to import shared source; `vite.config.ts` imports `shared/src/constants` directly.
