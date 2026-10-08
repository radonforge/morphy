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
pnpm bot:sim            # bot-only rounds in a real room on a virtual clock: win rate, hunt length
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
change, and for what the production client takes from it: `deckLightsFor` (`DeckLights` in
`Scene.tsx`), `DEFAULT_ROOM_LIGHT_COUNT` and `streetLamp`, which stands the lobby's North District
lamps the way a document's lamp compiles; `@morphy/level` and `@morphy/shared` are pure and declare
`"sideEffects": false`, so the rest tree-shakes out of the bundle. Without the flag it did not: level's
editor ops and checks shipped to the browser, and the asset cards landed in the entry chunk.

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
- `maps.ts`: `MAP_CATALOG` (the two selectable maps and their lobby metadata: name, theme, `tag`, blurb), `MapId`, `isMapId`, and `DEFAULT_MAP_ID` (North District, the first-run pick). The client renders the lobby's slices straight from it (one per entry, so the menu needs no change for a third or fourth map); the server keys `MAP_BUILDERS` on the same ids as a `Record<MapId, …>`, so a half-added map fails `typecheck`. Adding a map is one entry here plus four `Record<MapId, …>` the compiler then demands: the builder (`server/maps/index.ts`), `MAP_GLASS` / `MAP_THEME_BASE` (`client/theme.ts`), `STAGE_THEMES` (`client/ui/LobbyStage.tsx`) and a lobby diorama (`client/ui/lobbyDioramas.ts`, ~20 hand-placed set pieces and the only part with no compiler to catch a bad job). Editorial copy belongs here, never CSS.
- `weapons.ts`, `avatars.ts`: the selectable weapon and avatar catalogs, same catalog-plus-validator shape.
- `party.ts`: private-room codes over a look-alike-free alphabet; the code **is** the Colyseus roomId, so joining a party is a plain `joinById(code)`.
- `agent.ts`: the two-level `Intent` / `Observation` contract shared by server and bot. **Types only**: both sides run in one process, so nothing here is serialised and there are no validators. The `parseIntent` / `parseObservation` guards it used to carry existed for an out-of-process policy that was never built; they were removed, not kept warm (git history has them).
- `geometry.ts`: `rayAabb` and friends, shared by server hit resolution and the bot's hit prediction.
- `async.ts`: `withTimeout`, which forces callers to dispose a value that resolves after the timeout.
- `random.ts`: `makeRng`, the seeded mulberry32 PRNG behind every map's seeded variation.
- `modelFit.ts`: `uniformFitScale`, the uniform scale that seats a GLB in its prop's bounding
  cylinder; the client's `fitModel` and the level checks both call it, so they never disagree.
  `fittedExtent` is the box a catalog shape renders at through it, which the level footprints
  and the bots' sight samples both measure.
- `assetTags.ts`: `ASSET_TAGS`, what geometry cannot settle about each catalog prop's model: its
  front, its symmetry (how many quarter turns leave it looking the same: 1, 2 or 4) and its mount
  (floor, wall, surface), each marked `auto` (a proposal the owner kept on review) or `human`. A
  typed literal, not JSON, so the compiler checks every value and the production bundle drops it; a new
  catalog prop fails `tests/asset-cards.test.mjs` until it is tagged.
- `assetCards.ts`: `ASSET_CARDS`, the geometry `pnpm cards` reads off every runtime GLB (size,
  centre, support surfaces). A City Kit building's card also lists its ground-level `doors`: the
  extractor finds the panels painted with the kit's door swatch that stand on the ground at door
  size, solid and garage doors alike; glass shop doors use another swatch and are not read.

### `packages/level`: the level document

Raw TypeScript like `@morphy/shared` and depending only on it: it must never import server or
client code, three.js or Colyseus.

- `document.ts`: `LevelDocument`, a map as a document of intents on the `TILE` grid (rooms as cell
  rects, each with an optional `ceiling` of `glass` (the default) or `solid`, doors on grid edges,
  placed catalog objects, spawn points, optional night `lights`), and `parseLevelDocument(input,
  { catalog, id? })`, the file boundary: it throws `LevelValidationError` naming the document, the
  offending entity and a fix hint (a different map id than asked for, overlapping rooms, duplicate
  ids, unknown types, a door with the same region on both sides or in the outer wall, anything
  outside the map, a light inside a wall).
- `compile.ts`: `compileLevel(doc, { catalog, seed })` → `MapDefinition`. **Positions in a document
  are fixed**: the seed only picks floor and wall tile variants, so a document-authored map has the
  same furniture every round by design, and the same lights (`MapDefinition.lights` is the
  document's, copied). Every floor cell also gets a `MapDefinition.ceiling` panel on the wall tops
  (`emitCeiling`): the client draws glass as a ribbed pane the stars show through
  (`game/CeilingView.tsx`), never a collider, and `capUnderCeiling` (`game/ceiling.ts`) keeps the
  prop's third-person camera under it, which also stops it looking over the walls into the next
  room. A map without `ceiling` (North District) is open sky.
- `outdoor.ts`: what `setting: "outdoor"` compiles to. Outdoors a room is open ground with a
  `ground` kind (`paving`, `grass`, `yard`; `MapDefinition.ground` patches the client draws in
  `game/GroundView.tsx`), never walls, doors or a ceiling; `blocks` are solid cell rects of a
  `zone` (residential, commercial, industrial) that `compileOutdoor` splits into lots of at most
  11 m and dresses with the kit building that fills each lot best, its front turned to the most
  open side, and a collider over the whole lot at that building's height (so a shot passes over a
  low house); a block with `building` holds that one model instead (the landmarks). Which model a
  lot gets depends on the block id, never on the seed, because colliders follow it. A light with a
  `fixture` stands a road-kit street lamp (pole collider included) and hangs the light from its
  arm. An unseen wall closes the map's edge and any cell that is neither ground nor block, and
  low-detail facades stand beyond the edge wherever open ground meets it. `streetLamp` is how one
  lamp stands (model, height, head, footprint centre), shared with the lobby, whose North District
  diorama stands its lamps through it at the diorama's own scale. `OUTDOOR_MODEL_PATHS`
  feeds the asset allow-list. The checks measure one sightline over all the open ground (no wall
  separates one ground region from the next), and an object across two ground regions is fine.
- `floorplan.ts`: `emitFloorplan`, turning a region grid and its doors into floor tiles, wall tiles,
  wall colliders and gates (which keep `gate.glb`: the bot finds doorways by that name), plus
  `doorKey` (the `axis:line:cell` identity parser and emitter share) and `FLOORPLAN_MODEL_PATHS`.
- `checks.ts`: `validateLevel(doc, { catalog, cards })` → `LevelReport` (`findings`, `unplaced`,
  `metrics`), the spatial translator an agent edits by instead of screenshots. Objects are measured
  by their **real rendered footprint** (`footprint.ts`: the GLB's asset card through
  `uniformFitScale`, the same arithmetic the client's `fitModel` delegates to); passage, doorways
  and spawns by the per-part collision boxes, rotated with the object, that the client moves
  against (they always contain the footprint), less the parts no taller than `LEVEL_STEP_HEIGHT`,
  which a body steps onto. Shapes whose vertical spans do not meet never overlap. Outdoors,
  `entrance.blocked` reports any object footprint or lamp pole in front of a building's doorway
  (`outdoorEntrances` in `outdoor.ts`: the doors on the buildings' cards that open onto walkable
  ground), so set dressing never stands in a doorway, and `passage.blocked` reports objects
  that close a way a `LEVEL_PASSAGE_WIDTH` walker takes on the bare layout (a car left in a
  lane or across its mouth), measured by the detour round them; indoors it is not run, since
  a station room is furniture, not a route. `map.few-disguise-types` is an error under
  `MIN_DISGUISE_TYPES`, the same rule `buildMap` refuses a map by. Codes are listed
  in `FINDING_CODES`; thresholds are the `LEVEL_*` constants in `shared/constants.ts`.
  Reachability floods a `LEVEL_SAMPLE_CELL` grid from the hunter spawns with the client's body
  radius, so a pocket under `LEVEL_UNREACHABLE_MIN_AREA` is sampling noise and is not reported, and
  is skipped (the spawns are reported instead) when no hunter spawn is walkable. Open ground with no
  door onto it and no spawn on it is the void outside the map, not floor, so a station with an irregular outline is not
  reported as unreachable. The station's
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
  `corridor`, the theme preset (`DeckLightPreset` in `game/themes.ts`) owns colour, intensity and reach.
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

- `index.ts` boots `defineServer` with `WebSocketTransport`. **Uses `@colyseus/core` + `@colyseus/ws-transport` directly, never the `colyseus` meta-package**: this is deliberate (see pnpm-workspace `allowBuilds` / `minimumReleaseAgeExclude`). Matchmaking is `filterBy(["map"]).sortBy({ clients: -1 })`: quick play joins the busiest room **on the map the player picked**, and opens one there when none exists, so a lobby pick is binding instead of a hint. The filter was deliberately absent until 2026-09-17, on the grounds that it splits a small pool by map, reversed because `botFill.ts` now pads a thin public room to `BOT_FILL_TARGET` within `BOT_FILL_DELAY_MS`, so the empty-room outcome it guarded against no longer happens. Do not re-remove it without also removing bot fill. `map` is a required field of `PublicJoinOptions` and the CLI bot sends it too, which is load-bearing: it is what makes the lobby pick binding. A caller that omits it is not filtered by map at all (`RegisteredHandler.getFilterOptions` in `@colyseus/core` 0.17.44 copies only the options the caller owns, by `hasOwnProperty`), so it joins the busiest public room on either map. An explicit `map: undefined` is a different case, reachable only in process (serialising the options drops it, so over the wire it arrives omitted): it is a condition no room's `metadata.map` meets, so the caller always opens a new room, which `onCreate` puts on `DEFAULT_MAP_ID` and later callers on that map then join. Private rooms are unaffected (`create` / `joinById` bypass matchmaking entirely), and a public room's map never changes after `onCreate` (`handleSetMap` returns early unless `isPrivate`), so the value the filter stored cannot go stale.
- `rooms/MorphyRoom.ts`: the whole game. Holds `RoomState`/`PlayerState` (`@colyseus/schema` classes; note `experimentalDecorators` + `useDefineForClassFields: false` in its tsconfig). Owns the round state machine (`lobby → starting → hiding → hunting → round_end`), role assignment, the patch loop, and **server-side hit resolution** (ray vs. prop bounding cylinders + wall AABBs). Every inbound WS payload is validated by a `parse*` helper that returns `null` on bad input (silently ignored, never trusted). Capture is **infection**: a hit prop becomes a hunter and stays in play, so the round ends when no prop is left. Nobody spectates either: a hunter whose misses run its HP out respawns after `HUNTER_RESPAWN_MS` at `CONVERTED_HUNTER_HP`, on the spawn point furthest from the live props, so props win on the clock (or at once if every hunter walks out), never because the hunters ran dry. A public room with enough players goes from `round_end` straight into the next `starting` (`afterRound`): the Ready lobby is only where a room first gathers, or falls back to when it runs thin, and a private room still returns to its lobby for the host. Joins are accepted between rounds (`lobby`, `starting`, `round_end`), and the room locks as roles are dealt in `beginHiding`, not when the countdown starts, so a player arriving at a result card is dealt into the next round instead of opening an empty room. A prop taunts for points with `F` (`MSG_TAUNT_REQUEST`): a per-round `score` shown in the standings and never persisted, more with a hunter close by; one that has not taunted for `TAUNT_INTERVAL_MS` is made to, for nothing, on a clock staggered per prop so forced taunts never fire in unison. A hunter's `F` is a sonar (`MSG_SONAR`): every live prop within `SONAR_RADIUS` honks as a forced taunt, decoys stay silent (the hunter's answer to them), and the pulse itself is broadcast (`MSG_SONAR_PING`) so props hear a hunter close by.
- Maps: **two hand-authored maps**, one builder each (`maps/urban.ts`, `maps/station.ts`), registered in `maps/index.ts` as `MAP_BUILDERS` and chosen from the lobby picker. `buildMap(id, seed)` runs on `onCreate` and again when a party host switches map, **not** per round; a fresh seed only reshuffles the station's floor and wall tile variants, and North District does not vary at all. Both maps are level documents, `maps/station.level.json` and `maps/urban.level.json`, parsed through `parseLevelDocument` when the map registry loads and compiled by `compileLevel`. Kepler-9's furniture was converted once from the retired archetype furnisher at seed 1; North District (an outdoor document since 2026-10-06: four courtyard blocks turned round a central park, plan B of the concept board) was generated once from a measured concept plan and replaced the procedural street grid, whose straight roads made every street a 108 m sightline. Both are now edited in the document, not generated, and `spaceCatalog.ts` / `urbanCatalog.ts` are the per-theme prop catalogs: the shapes players can morph into. An entry flagged `decor` (North District's parked cars and work-site fence) dresses the map but is never dealt, rerolled into, counted as a disguise by the level checks or suspected by a bot (`isDisguise` in `shared/map.ts`). A prop is dealt and rerolls only into a disguise the map actually places (`disguiseTypes`), since a catalog shape nothing on the map looks like gives its wearer away; `buildMap` refuses a map placing fewer than `MIN_DISGUISE_TYPES` (2), so a reroll always has another shape to take. A third map, Ares Outpost (`mars`), was cut on 2026-09-25: open ground with long sightlines is the opposite of what a prop hunt needs, and two maps split the small player pool less than three. Each document also authors hunter spawns away from the prop spawns (urban at the four town gates, props in the park; station along the corridor spine), and `beginHunting` teleports each hunter to the one furthest from every live prop, because everyone waits out the hide where the round dealt them and a hunter released beside a new player caught them within seconds. The client's production asset allow-list is built from **every model path a map can emit for any seed**: `FLOORPLAN_MODEL_PATHS` and `OUTDOOR_MODEL_PATHS` from `@morphy/level` cover every tile, building and lamp a document can compile to, and both maps' props are their catalog models.
- `rooms/roomErrors.ts` + `MorphyRoom.onUncaughtException`: Colyseus wraps a room's `clock` callbacks and `onMessage` handlers in a try/catch **only if the room defines `onUncaughtException`** (`Room.mjs` gates the wrapping on it), and `@colyseus/clock` has no guard of its own. `index.ts` also asks for no graceful shutdown, so Colyseus installs no process-level net underneath. Without the hook a throw takes down the whole Node process and every other room on it, measured both ways, for an interval or phase timer (`sendPings` runs every 2 s in every room) and for a message handler reached by a bad payload. Do not remove it. The formatter exists because these exception objects carry the input that caused them (`OnMessageException.payload` is the raw client message, `OnJoinException.options` holds the device id), so the log gets the method, message type, truncated session id and error only, never the payload.
- `rooms/botFill.ts` + the bot block in `MorphyRoom.ts`: a quiet **public** room pads itself to `BOT_FILL_TARGET` presences with server-driven bots after `BOT_FILL_DELAY_MS`, and hands a bot's seat back the moment a human joins, so bots never take a slot a player wants nor make the room look fuller to the matchmaker. They hold a synthetic `bot:<n>` session id, are never added or removed mid-round, and their motor output goes through the same `handleInput` / `handleShoot` / `handleReady` entry points a real client's messages do, so a bot has no authority a player lacks. They also get no *information* a player lacks: `addBot` runs them with `visibility: "limited"`, so a bot hunter has to find a prop by line of sight, movement and shape instead of reading `role` off it. What it sees is one predicate, `Reflex.sense` over `packages/bot/src/perception.ts`, read by the observation, the policy's wake-up, the motor's chase and the attribution of a honk alike, so no path sees what another hides: a hunter sees only the cone it faces (`HUNTER_VIEW_HALF_ANGLE_RAD`, derived from the client's default field of view at 16:9, with bounded glances aside while it searches), a prop sees all round as a player's orbiting camera does, and nobody sees through a wall or a piece of furniture (the boxes of its catalog parts, turned with it), though any sampled point of a body that shows is enough; the points lie inside the model it renders as (`fittedExtent`, turned with it), never in the part of its hit cylinder the model does not fill. Hit resolution is unchanged: furniture blocks eyes, not shots. Shape is `ObservedEntity.disguised` (whether a contact wears a disguise at all, never which one), and it is deliberately in the limited view because a player reads it off the screen: an undisguised contact renders as a character with a weapon, so it can only be a hunter. Without it a hunter bot could not tell a teammate from a disguise that happened to be moving, and hunters pooled into a pack that stared at each other for the round (fixed 2026-09-09). **It is absent whenever the contact is out of line of sight**, because footsteps through a wall tell a player nothing about shape: a heard contact is "might be anyone", so a bot still searches a noise instead of writing it off as a teammate. A bot hears the rustles `PropFootsteps.tsx` plays, though not at its cadence: a live prop that stepped more than `MOVED_RECENTLY_MIN_DIST` within `MOVED_RECENTLY_MS`, where the client rustles once per `STEP_DISTANCE` (2.2 m) covered, so a short shuffle no player hears can still reach a bot. It never hears a spin or a hunter's footsteps (no client plays those, so bots stopped hearing them on 2026-10-08). A rustle out of sight is a snapped *spot*, its own handle named by the place (`heardSpotSource`), never the player's, so following it leads to where it was heard and not on to wherever its maker went. Keep that gate: it is the whole reason the field is fair. `disguised: true` alone never marks a player, because a hunter is shown every **scene prop** in sight as well, and a decoy in sight, each listed exactly as a disguised player standing still (same fields, opaque handles dealt nearest first from one sequence, never session ids). Until 2026-09-25 the list held players only, so any disguise in sight was a prop by construction and bot hunters shot it on sight: they won every round, with a median hunt of 4 s. A disguise becomes a *suspect* only on a tell a player would see, `ObservedEntity.tellRecently`: seen moving or spinning, seen changing shape, or seen honking, within `BOT_TELL_WINDOW_MS`. *Seen* is literal: a step, spin or reroll counts only between two ticks that both saw the player, so one that reappears after a gap is measured from where it is seen again, and a honk counts as seen only when the player it came from is in sight from where the bot looks as the honk plays, not as the tick began. Without a suspect the hunter *probes*: at most every `BOT_PROBE_INTERVAL_*_MS` (by difficulty, `ObservedSelf.canProbeNow`) it shoots the nearest object in reach it has not tested yet, and pays the same miss damage a player does when that was furniture (halved on a decoy). A suspect in reach is shot at whether it stands or runs, and the aim (`packages/bot/src/aim.ts`) is a player's, not a raycast's: a reaction time drawn per new target, a trigger that hesitates as the crosshair strays, and a per-shot error that grows with how fast the target was *seen* crossing the line of sight, its distance and the bot's own speed, so a runner is often missed and the miss costs HP. Until 2026-10-08 a moving suspect was never shootable, so a hunter chased a runner and fired a second or two after it stopped. Bot-only balance is measured with `pnpm bot:sim`. A hunter bot also perceives nothing during `hiding`, since a human hunter sits behind a blindout card, and its movement samples are dropped as the round begins, so no prop reads as "seen moving" for the walk to its spot. A bot prop hides as the disguise it was dealt, planning from the map alone through the `Terrain` the driver hands its policy (layout and furniture, never players): beside objects of its own kind, turned like them modulo `ASSET_TAGS` symmetry, where the shape's mount belongs, in cover and with a way out, drawn among the good spots (`policy/hiding.ts`). Its disguise yaw is its own (`Reflex.disguiseYaw`), never its walking or looking heading, and turns only once it stands on its spot with no hunter in sight. In the hunt it holds still while a hunter it sees is not on to it (aim from a distance proves nothing) and runs (`policy/escape.ts`, scored against perceived threat positions only) from one aiming at it from `POINT_BLANK_RADIUS`, one closing in while it keeps it in sight, one that watched it move or honk, or a sonar pulse right next to it; the run commits for `ESCAPE_COMMIT_*_MS` and while a hunter stays on it, then it hides again after a calm. Rustles never move it: only props make them. It drops a decoy on its hiding spot as it breaks cover, keeping `DECOY_RESERVE` for point blank, from the stock and cooldown its HUD shows (`ObservedSelf.decoysLeft` / `canDecoyNow`), taunts on the hunt's clock (`Observation.phaseMs`), ahead of the room's forced one, and moves to a new spot after a honk it did not choose (`ObservedSelf.forcedHonkMsAgo`: `letBotsHear` tells a bot its own disguise honked, as a player hears their own, and the reflex tells a forced honk from one it pressed for). It never rerolls. A bot hears what a player's client plays positionally the same way: a sound in `Observation.sounds` with a position (exact in sight, snapped otherwise) and no source. Bots are not clients, so the room hands each broadcast sound to them itself (`letBotsHear`); forget that and a new sound reaches every human and no bot. `"full"` reads ground truth and is a measuring anchor, not a way to play; do not wire it into a live room. Those handlers take an `Actor` (just `sessionId` + `send`) rather than a Colyseus `Client` for exactly that reason. Private rooms are never filled.
- `MorphyRoom.onDrop` / `onReconnect`: a dropped connection holds its seat for `RECONNECT_WINDOW_MS` instead of leaving the round: the player stays in `state.players` with `connected = false`, keeps role and position, and rejoins on the same session id **without passing through `onJoin`**, so neither the in-progress guard there nor a running round's `lock()` shuts them out. Colyseus runs `onLeave` itself when the window lapses, so every existing cleanup and award path still runs, just later. A lobby seat is handed straight back: there is nothing to come back to. Consequence to keep in mind: a held seat is *present in the room but not in the game*, hence `presentCount()` for start thresholds, `firstPresentHumanId()` for the abort award, and `assignRoles` dealing absent players out of the round.
- `stats/repository.ts`: lifetime player stats in SQLite (`node:sqlite`), keyed by an opaque device id the client mints in localStorage and sends both as a join option and as the `x-device-id` header of `GET /stats` (`http.ts`). `config.ts` reads `MORPHY_DB_PATH`, which production sets outside the deploy directory so a redeploy never wipes accumulated stats. `DELETE /stats` (the Stats pane's Reset my stats) erases one device's row, and `stats/retention.ts` sweeps at boot and daily for devices whose last round is older than `STATS_RETENTION_MS` (12 months): the privacy notice (`client/content/privacy.md`) promises both, so change them together.
- `playerCounts.ts` + `GET /player-counts` (`http.ts`): the humans on each map, which the menu polls while it is on screen and shows on each slice when above zero. It sums the matchmaker's `clients` over public rooms by `metadata.map` (`MorphyRoom.applyMap` publishes it), so bots, which hold no connection, never count, and `state.players` must never be counted instead. Locked rooms count (a room is locked for the whole round), private ones never do (a party code is its room id), and `cachedFor` runs one `matchMaker.query` per `PLAYER_COUNTS_TTL_MS` however many menus poll, never two at once, and keeps a failed one for `PLAYER_COUNTS_RETRY_MS` so a broken query is retried and logged once per window. Production needs the `location = /player-counts` block of `deploy/nginx.conf` applied on the host, like `/stats`; without it the path answers with the page, and the client warns once in the console.

### `packages/client`: Vite + React + react-three-fiber

- `ui/App.tsx`: the shell owning connection state, swapping between menu and game (the game route is `lazy`-loaded behind a `Suspense`). `ui/Lobby.tsx` + `ui/LobbyStage.tsx` are the menu: name, ready state, party codes, `StatsPane`, and **one diagonal slice of the screen per map** (`ui/MapSlices.tsx`), the open one wide and in full colour with the map's name and Play, the others dimmed with their names standing up. Clicking a closed slice (or Left/Right, or 1-4) opens it, the avatar morphing into that world, and Play always plays the open map, so choosing and starting are one gesture; in a party only the host can open another. The slice geometry (edges, slant, how each slice frames its world) is the pure `ui/worldSlices.ts`, under test, read by both the DOM slices and the stage. The stage is **one canvas with one world per map**, each its own scene drawn through its own camera into its slice: the open world is drawn live every frame through the post chain, a closed one only when its framing changes, then copied to a texture and laid back down as its slanted shape, so a still menu costs one diorama however many maps it shows. The camera never changes lens: a slice only chooses which part of today's frame it shows (`setViewOffset`), and the avatar stands right of centre so the name and Play have the left of the open slice. The avatar is chosen by morphing through the catalog on the stage, not from a grid; the open slice takes the whole screen while it is open, so the picker frames exactly as it did before slices. It runs off `ui/CarouselRail.tsx`, `ui/carousel.ts`, `ui/carouselWheel.ts` and `ui/useCarouselInput.ts`. `carouselWheel.ts` is where the reasoning about trackpad inertia lives, and it is a pure fold under test; do not reinline it into a component. **The callsign is inside the avatar picker**, not in a menu of its own: naming yourself and picking a shape are one decision, so the Identity pane that held them separately was removed (2026-09-17) once the only other thing in it was a third button opening this same picker. The name commits on blur and on picker close, the avatar per step, and `useCarouselInput` ignores arrows while the field has focus. The opener is the chip over your avatar, which is why `LobbyStage` portals it out of `.menu-canvas`: that subtree is `aria-hidden` for the 3D scene, and it was the only keyboard path left. The weapon picker is in-game, not here (`game/Game.tsx`). `net/connection.ts` wraps the Colyseus SDK `joinOrCreate` / `create` / `joinById` with a timeout. The stage reads each map's sky and light presets (`themeFor`) from `game/themes.ts`, never from `game/Scene.tsx`: importing anything from Scene loads its whole chunk with the menu. A day/night map's stage is drawn by night at random once per page load (`NIGHT_CHANCE`), with the match's own night theme, `StreetLamps` and `SkyGlow`. They are not in `client/theme.ts` either, which the menu shell imports for `MAP_GLASS`: anything there ships in the entry chunk, before first paint. `ui/Dropdown.tsx` is the game's select, a WAI-ARIA select-only combobox in the game's style; use it rather than a native `<select>`.
- `game/Game.tsx`: React HUD and the network event hub: registers all `room.onMessage` handlers and the schema `Callbacks` (player add/remove), drives chat/kill-feed/result/scoreboard overlays.
- `game/Scene.tsx`: the entire 3D scene: map rendering (instanced tiles, fitted GLB props/avatars, scenery), remote-player interpolation, the shooting raycast, pointer-lock mouse look, and the per-frame drive of the local player through `movement.ts`. Still the densest file in the client. **There is no prop picker**: a prop presses `R` to send `MSG_REROLL` and the *server* swaps in a random different disguise the map places, spending one of a bounded `rerollsLeft`. `Q`/`E` are prop-only and turn the disguise in place (`propRot`), not the camera; aim is mouse-look alone. A tap turns it to the next mark of the current step and a hold spins it at `PROP_TURN_SPEED` (`game/propTurn.ts`); `X` (handled in `game/Game.tsx`) cycles the step through `PROP_TURN_STEPS_DEG` (90, 45, 15), remembered as `morphy:turn-step`. Do not re-add a picker believing one was lost. `V` swaps a prop between the camera behind it and first person from inside its disguise (`game/propView.ts`, remembered as `morphy:prop-view`); hunters stay first person, since a third-person hunter could peek round corners. The field of view is a player pref (`game/prefs.ts`, `morphy:fov`, 50 to 70 degrees, default 55).
- **Day and night**: a map whose `MAP_CATALOG` entry has `dayNight` (North District) is drawn by day or by night as each countdown starts (`RoomState.night`, `NIGHT_CHANCE`); `themeFor(mapId, night)` swaps in its night theme. At night `game/StreetLamps.tsx` glows every lamp bulb in `MapDefinition.lights` that carries a head height, but hangs only `budget` real point lights, held by the lamps nearest the player, because a forward renderer pays for every light on every lit pixel (36 lights took a frame from 8 to 15.6 ms on an M4 Pro). Ranking by the player rather than the orbiting prop camera, and `lampWeights` (`game/lampBudget.ts`) dimming a light to zero before it changes lamp, is what keeps the pools from popping while you walk: ranking by the camera measured 98 full on/off pops in a 10 s walk. The lights fall off with `decay` 1, not the physical 2, because every lamp hangs 2 m from a facade and decay 2 blew those facades out.
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
  game's own renderers (`MapView`, `DeckLights` from `game/Scene.tsx`, `themeFor` from `game/themes.ts`); `Tab` swaps to
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
  unique-type overlays are toggles. The plan view never draws the ceiling; `C` toggles it in the 3D
  view. The pure parts (`edits.ts`, `history.ts`) are tested in
  `tests/editor.test.mjs`.
  **Try it** saves, waits for `tsx watch` to restart the game server (a document write always
  restarts it, since the server imports the JSON), and opens `App` with `tryMap`, i.e. a private
  room on that map; a private room needs a second player to start, so a dev-only card over the room
  (`TryHint.tsx`) spells out `pnpm bot -- --code <party code> -n 1` and offers Back to editor.
- `game/audio.ts`: **hybrid audio**: weapon shots / hit impacts (Kenney Sci-fi Sounds, `public/sounds/sci-fi/`) and lobby UI cues (Kenney UI Audio, `public/sounds/ui/`) play cached OGG samples; the lobby loops a licensed theme (`public/sounds/music/lobby-theme.ogg`, own gain, fade in/out); every other cue is synthesized at runtime via the Web Audio API (oscillators + noise bursts). Everything routes through one master gain, so mute covers all; volume / music / UI-sound prefs persist to localStorage (`morphy:*` keys). Positional cues (taunts, sonar, prop rustles) pan by the camera's facing through `spatialAudio.ts`; a remote prop on the move rustles (`PropFootsteps.tsx`) out to `FOOTSTEP_HEARING_RADIUS`, the very radius a bot hears a mover at, so keep the two on the one constant.
- **Site pages**: `viteSitePages.ts` renders the repo-root `CHANGELOG.md` to `/changelog` and every
  `packages/client/content/<slug>.md` to `/<slug>` as static HTML with no script and no 3D (a missing
  or empty `content/` leaves only the changelog). A build emits `dist/<slug>.html` beside
  `index.html`; the dev server renders them on each request, so `pnpm dev` shows an edit on reload.
  `siteMarkdown.ts` is the pure converter for the one markdown subset these files may use (`#` to
  `###` headings, paragraphs, `-` lists with two-space continuation lines, `**bold**`, `` `code` ``,
  `[text](url)` links); it escapes every text and attribute and refuses any link that is not
  https:, mailto: or site-relative, which fails the build. Its changelog view turns each
  `## [x.y.z] - YYYY-MM-DD` into a release block, labels Added as New, and leaves `[Unreleased]`
  and link reference definitions off the page. `sitePage.ts` is the one page template (title,
  description, canonical, `og:*`, a nav linking only the pages the build has); a new page needs an
  entry in its `NAV_LINKS` or the build fails, and a slug the site already serves (a `public/`
  name, `index`, `colyseus`, `stats`, `player-counts`, a dev root) is refused. Everything here runs
  in Node, so the client bundle does not change; `tests/site-pages.test.mjs` covers it from
  `tests/fixtures/site/`.

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
roads, street props), `urban/cars` (Car Kit vehicles, parked as decor) and `urban/street` (pieces
of City Kit Roads 2.1, whose colormap was reorganised, so they keep their own instead of sharing
`urban/roads`'). Kenney kits reference an external `Textures/colormap.png` per kit; keep that
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

Release workflow: tagged. A release PR renames `## [Unreleased]` to `## [x.y.z] - YYYY-MM-DD` (leaving an empty Unreleased above it) and bumps the root `package.json` version; the tag goes on its merge commit.

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
The site pages depend on it: the `location ~ ^/[a-z0-9-]+$` block serves `/<slug>` from
`<slug>.html` with `Cache-Control: no-cache` like `index.html`; without it `/changelog` and the
other pages fall through to the game in production. Apply that block on the host by hand before
the first release that ships them.

## Conventions

- All user-facing strings are **English**.
- Gameplay constants → `shared/constants.ts`. Rendering/layout constants → module-level `const` at the top of the file that uses them. No inline magic numbers in logic.
- `VITE_SERVER_URL` overrides the server URL on the client (default: same-origin `/colyseus`, proxied by Vite to `:2567`). Server `PORT` env overrides `2567`, and the Vite dev proxy follows it, so `PORT=2600 pnpm dev:server` beside `PORT=2600 pnpm dev:client --port 5190 --strictPort` runs a second stack next to the first.
- The Vite dev server proxies `COLYSEUS_PROXY_PATH` (`/colyseus`) to the game server and needs `fs.allow: ["../.."]` to import shared source; `vite.config.ts` imports `shared/src/constants` directly.
