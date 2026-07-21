# morphy.lol — Project spec

> Browser multiplayer prop hunt. Starts LAN-first (a colleague hosts, the others connect; cloud-ready with the same code). Low-poly 3D, simple but polished. Theme: **space station on Mars**.

## 1. Vision

You hide by blending in among the objects of a 3D scene (the **props**), while the **hunters** flush you out. The appeal is in the spatial camouflage and deduction, not the assets.

The aesthetic is low-poly based on the **Kenney** kits (glTF models with flat colormap textures), with good lighting and a clean palette. Three hand-authored, themed maps ship today and are picked in the lobby: a pressurized space station, an open-air Martian outpost (rockets, hangars and wrecks dressing the surrounding plain), and an urban district. Every prop has a primitives fallback (box/cylinder/cone) if the model is missing.

Quality goal: *in its simplicity, it should impress*.

## 2. Game loop

Round state machine, managed **authoritatively by the server**:

| Phase | What happens | Duration |
|---|---|---|
| `lobby` | Players join, choose a name, mark "ready" | — |
| `starting` | Countdown before role assignment | `START_COUNTDOWN_MS` |
| `hiding` | Roles are assigned; props scatter and morph; hunters are **locked** (blacked-out screen, no movement) | `HIDE_DURATION_MS` |
| `hunting` | Hunters free; main phase | up to `ROUND_DURATION_MS` or early end |
| `round_end` | Winner screen + standings | `ROUND_END_MS` → back to `lobby` |

The round starts from `lobby` when there are at least `MIN_PLAYERS_TO_START` players and **everyone** is "ready".

**Role assignment** (every round, random): `HUNTER_RATIO` (~1 hunter per 4), minimum 1 hunter and always at least 1 prop. Roles are reshuffled every round.

**Win conditions** ("infection" model, see §3):
- **Hunters** win if **all props are converted** (no prop alive).
- **Props** win if **at least one prop is still alive when** `ROUND_DURATION_MS` **expires**, or if **all hunters self-eliminate** (HP to 0 from missed shots).

The early end is evaluated by the server after each shot, when hunting begins, and when a player leaves.

## 3. The "caught" mechanic — shoot + penalty

The heart of the balance. The hunter shoots; missing costs.

- **Left click = shot**, with a per-weapon cooldown to prevent spam.
- The client sends only `shoot { dir }`. The server derives the ray origin from the synchronized player position plus `PLAYER_EYE_HEIGHT`, then performs the raycast within the selected weapon's range against the authoritative hitboxes of living props, occluded by walls:
  - **Hit a prop-player** → **converted**: switches to the **hunters** team (stays in play, first person + weapon) instead of becoming a spectator. **Infection mode**: the round ends when the last prop is converted.
  - **No prop or decoy hit** (wall, void, out of bounds) → **missed shot**: the hunter takes the selected weapon's `missDamage`.
- A hunter at 0 HP (`HUNTER_MAX_HP`) is **out for the round** (spectator).

**Prop hitbox**: derived from the volume of the prop you morphed into — a vertical cylinder (`computePropBounds`) computed from its primitives, approximated to an AABB server-side. An un-morphed prop uses a fixed hitbox (`UNTRANSFORMED_PROP_RADIUS` × `UNTRANSFORMED_PROP_HEIGHT`). Design consequence: morphing into a large object makes you a larger target.

Why it works: the penalty turns "shooting at random" into **deduction** — you can't spray everywhere, you bleed out. You have to spot the anomaly ("that crate wasn't there", "that computer moved").

**Mandatory taunt** (prop-side balancing): every `TAUNT_INTERVAL_MS` the server forces a taunt on every living prop → broadcasts `taunt { playerId, x, z }`. The client plays positional audio (volume by distance) and a brief "wiggle" (scale pulse) of the mesh. It forces props to give away their position at least a little.

> Hit resolution **authoritative on the server** = the anti-cheat piece that matters. Movement is more permissive (see §7), acceptable for a game among colleagues.

## 4. Controls

| Input | Action |
|---|---|
| `WASD` / arrows | Movement |
| `Shift` | Run (everyone; hunter `RUN_MULTIPLIER_HUNTER` > prop `RUN_MULTIPLIER_PROP`) |
| `Space` | Jump |
| Mouse | Look rotation (pointer lock; hunter in first person, prop in third) |
| Left click | Shot (hunter only) |
| `R` | Change disguise to another random prop (limited reroll budget) |
| `Q` / `E` | Rotate the prop disguise |
| `C` | Drop a decoy of the current disguise (limited budget) |
| `1` / `2` / `3` | Select hunter weapon |
| `T` | Chat: opens the input; `Enter` sends, `Esc` closes |
| `Tab` | Standings (hold) |
| `M` | Mute / unmute audio |
| `?` | Open / close the controls panel |
| `Esc` | Releases the mouse pointer / closes the chat |

**Prop disguise**: a prop receives a random catalog entry at role assignment and can spend a limited reroll with `R`. The player's **visual mesh** becomes that object. The **movement collider stays a fixed-radius circle** (player-sized), so you never get stuck; what changes is the appearance and the shot hitbox (§3), not the movement physics. `Q`/`E` rotates the disguise independently of movement, and `C` drops a destructible decoy using the same appearance.

## 5. Chat

A game-style text channel: `T` opens the input, the message goes onto the network channel and is broadcast to everyone. Boundary validation: text is trimmed and truncated to `MAX_CHAT_LENGTH`, empty messages are discarded; name truncated to `MAX_NAME_LENGTH`. The output is rendered as React text (automatic escaping, no XSS).

## 6. Data-driven map

A map is **data, not code**. The game engine knows nothing of the theme: it consumes a `MapDefinition`. Three hand-authored maps ship today — `station`, `mars`, `urban` — one per entry in `MAP_CATALOG`. The map is **chosen in the lobby** (the `map` join option) and **built once when the room is created** (`buildMap(id, seed)`), then stays fixed for the room's lifetime; it is not regenerated per round. Each builder is seeded, so tile variants, furnishing and scenery scatter vary run to run while the authored layout stays recognizable. The `MapDefinition` structure remains the contract: adding props/themes = adding catalog entries, a builder and models, not engine logic.

```ts
// packages/shared/src/map.ts
export interface Vec3 { x: number; y: number; z: number }

export type PrimitiveKind = "box" | "cylinder" | "cone";

export interface PrimitiveSpec {
  kind: PrimitiveKind;
  position: Vec3;
  size: Vec3;
  color: string;
}

export interface PropDefinition {
  id: string;
  name: string;          // "Chair", "Computer", "Container"...
  parts: PrimitiveSpec[]; // primitive composition = fallback mesh
  model?: string;         // glTF to use instead of the primitives
  modelScale?: number;
}

export interface PropInstance {       // furniture placed in the scene (static)
  type: string;          // id of a PropDefinition from the catalog
  position: Vec3;
  rotation: number;      // radians, around Y
}

export interface BoxCollider { position: Vec3; size: Vec3 }

export interface TileInstance {       // modular glTF piece (floor/wall)
  model: string;
  position: Vec3;
  rotationY: number;
  scale?: number;        // per-instance uniform scale (default 1)
}

export interface SceneryInstance {    // decorative exterior scenery (no collider)
  model: string;
  position: Vec3;
  rotationY: number;
  scale: number;
}

export interface MapDefinition {
  id: string;
  bounds: { min: Vec3; max: Vec3 };       // movement clamp
  spawnPoints: { props: Vec3[] };         // shared spawn ring; roles assigned in place
  colliders: BoxCollider[];   // static shell (floor + walls + solid scenery)
  tiles: TileInstance[];      // rendered modular pieces (instanced)
  scenery: SceneryInstance[]; // exterior set pieces (rockets, hangars, wrecks)
  props: PropInstance[];      // furniture placed in the scene
  propCatalog: PropDefinition[]; // shapes you can morph into
}
```

Runtime validation lives in `parseMapDefinition(raw: unknown): MapDefinition`
(`packages/shared/src/map.ts`): the **client** uses it on the map received over the network (`map` event)
before rendering it — prop instances with a `type` outside the catalog are rejected.
`computePropBounds(def)` derives a prop's bounding cylinder and is **shared** between
server-side hit detection and client-side mesh fitting, so the hitboxes match what you see.

### Builders

Each map is a builder `(seed: number) => MapDefinition` registered in `packages/server/src/maps/index.ts` (`MAP_BUILDERS`, typed `Record<MapId, …>` so the registry can't drift from `MAP_CATALOG`). A builder authors a region grid (`Cell[][]` + a door list) and hands it to the shared toolkit in `maps/lib.ts`: `makeRng(seed)` is a deterministic mulberry32 PRNG that drives the variation, and `emitFloorplan` compiles the grid into floor tiles, wall tiles, aligned AABB wall `colliders` and door `gates` — one source of truth keeping the visible walls aligned to their colliders. `furnish.ts` then fills each room from a set of **archetypes** (mess hall, quarters, control room, storage bay, lab) via `furnishRoom`, staying clear of doors and spawns; each theme scatters its own exterior `scenery` (e.g. the Martian apron's rockets, hangars and debris). The three maps key off their own prop catalogs: `spaceCatalog.ts` (station, ~29 objects), `marsCatalog.ts` (Mars surface) and `urbanCatalog.ts` (pedestrians + street furniture). Everything downstream of the seed is deterministic.

## 7. Stack & architecture

| Piece | Choice |
|---|---|
| Language | **TypeScript** everywhere |
| Client render | **Three.js** via **@react-three/fiber** + **@react-three/drei** |
| UI (lobby/chat/HUD) | **React** |
| Client build | **Vite** |
| Game server | **Colyseus** (`@colyseus/core` + `@colyseus/ws-transport`, not the meta-package; authoritative, room-based) |
| Monorepo | **pnpm workspaces** |

### Network model

- `MorphyRoom` room with state synchronized via `@colyseus/schema`.
- State broadcast at 20 Hz (`PATCH_RATE_MS = 50`); the client **interpolates** between snapshots and renders at 60 fps.
- **Server authority**: phase, timers, roles, HP, alive/dead, shot resolution, taunt, win, map build.
- **Movement (pragmatic)**: the client sends `input { x, y, z, rot }` at ~20 Hz (`INPUT_SEND_RATE_MS`); the server **only clamps to the map bounds**. No prediction/rollback, **no velocity sanity check** and **no server-side collision**: walls and furniture are handled **only by the client** (`Scene.tsx`). A deliberate choice to stay simple on LAN.

### Synchronized state (schema)

```ts
// packages/server/src/rooms/MorphyRoom.ts
PlayerState  { id, name, x, y, z, rot, aim, propRot, role: 'hunter'|'prop',
               alive, hp, kills, propType, rerollsLeft, decoysLeft, ready,
               avatar, weapon, ping }
DecoyState   { id, x, y, z, rot, propType, owner }
RoomState    { mapId, phase, phaseEndsAt, winner, hostId, isPrivate,
               players: Map<id, PlayerState>, decoys: Map<id, DecoyState> }
```

Phase, timer (`phaseEndsAt`) and winner live **in the synchronized state**, not in events: the client reads them by polling `room.state`.

### Message contracts (typed boundary)

Messages are separate Colyseus channels identified by `MSG_*` constants (`packages/shared/src/protocol.ts`), not a discriminated union.

```ts
// client → server
input     { x, y, z, rot, aim, propRot } // position, body/look heading, disguise heading
reroll                                  // random prop disguise, budgeted
decoy                                   // place a decoy, budgeted and rate-limited
shoot     { dir }                       // direction only; origin is server-derived
chat      { text }
ready     { ready }
map                                   // request the current MapDefinition
start                                 // private-room host starts the countdown
set_map     { map }                   // private-room host changes map in lobby
set_profile { name, avatar }          // live lobby profile update
set_weapon  { weapon }
pong         { n }                    // latency-probe echo

// server → client
map           MapDefinition           // generated once per room; rebroadcast after a lobby map change
teleport      { x, z }                // reposition to spawn
taunt         { playerId, x, z }
shot_result   { hit }                 // result of your own shot
shot_fired    { shooterId, weapon, origin, ends }
decoy_break   { x, y, z, propType }
kill          { byId, byName, victimId, victimName, reason }
chat          { fromId, name, text }
ping          { n }
```

The `reason` of `kill` ∈ `"shot" | "self" | "converted"`. All inbound payloads are **validated at the boundary** by `parse*` helpers that return `null` on invalid input (discarded, never propagated). No `any` in internal code.

### Repo layout

```
morphy.lol/
  package.json            # pnpm workspaces; dev/typecheck/tunnel scripts
  packages/
    shared/               # contract: types, protocol, constants, map model + catalogs
      src/{constants,protocol,map,maps,avatars,weapons,geometry,async,index}.ts
    server/               # Colyseus: room + authoritative logic + map builders
      src/index.ts
      src/rooms/MorphyRoom.ts
      src/maps/{index,lib,station,mars,urban}.ts   # one builder per selectable map
      src/{furnish,propDef,spaceCatalog,marsCatalog,urbanCatalog}.ts
    client/               # Vite + React + R3F
      src/ui/{App,Lobby,prefs}.tsx   # lobby / connection / saved prefs
      src/net/{connection,endpoints,stats}.ts  # Colyseus SDK + HTTP endpoint derivation
      src/game/{Game,Scene,audio,useControls,types}.ts(x)
      public/models/{space,space-station,space-kit,pets,blaster}/  # glTF assets (Kenney)
      index.html
    bot/                  # headless test players (dev tooling)
```

## 8. Configuration (no magic values)

All game constants centralized in `packages/shared/src/constants.ts`. URL/port from config, never inline.

```ts
export const ROOM_NAME = "morphy";
export const DEFAULT_PORT = 2567;
export const COLYSEUS_PROXY_PATH = "/colyseus";

export const MAX_PLAYERS = 12;
export const MIN_PLAYERS_TO_START = 2;
export const HUNTER_RATIO = 0.25;          // ~1 hunter per 4

export const START_COUNTDOWN_MS = 5_000;
export const HIDE_DURATION_MS = 20_000;
export const ROUND_DURATION_MS = 240_000;  // 4 min
export const ROUND_END_MS = 8_000;
export const TAUNT_INTERVAL_MS = 30_000;

export const HUNTER_MAX_HP = 100;
export const UNTRANSFORMED_PROP_RADIUS = 0.5;
export const UNTRANSFORMED_PROP_HEIGHT = 1.8;
export const PLAYER_EYE_HEIGHT = 1.6;

export const MOVE_SPEED = 5;               // units/s
export const RUN_MULTIPLIER_HUNTER = 1.7;
export const RUN_MULTIPLIER_PROP = 1.5;
export const JUMP_SPEED = 6;
export const GRAVITY = 20;

export const PATCH_RATE_MS = 50;           // broadcast 20 Hz
export const INPUT_SEND_RATE_MS = 50;

export const MAX_NAME_LENGTH = 16;
export const MAX_CHAT_LENGTH = 200;
```

Weapon range, cooldown, pellet spread and miss damage live in `packages/shared/src/weapons.ts`, keyed by weapon id. Client-side server URL comes from `VITE_SERVER_URL`; default = same origin + `COLYSEUS_PROXY_PATH` (`/colyseus`), which Vite proxies to the server in dev. The stats HTTP URL is derived from that same endpoint. Server port comes from `PORT` (default `2567`).

## 9. How to play (LAN-first → cloud)

- **Dev / LAN**: the host starts everything with `pnpm dev` (Colyseus server on `:2567`, Vite on `:5173`). Vite exposes on the network (`host: true`) and **proxies** `/colyseus` to the server, also deriving the WebSocket. Teammates open `http://<host-ip>:5173`: the client talks to the server through the proxy, **without configuring anything**. Alternatively you can point to a separate server with `VITE_SERVER_URL`.
- **Remote**: `pnpm tunnel` (ngrok on `5173`, optional `NGROK_DOMAIN`) exposes a single tunnel covering both client and WebSocket; the ngrok domain is already in Vite's `allowedHosts`.
- **Cloud**: the production workflow publishes the server image under the immutable commit SHA, rsyncs the built client, and deploys that exact server tag behind nginx. Only the configured public URL changes.

## 10. Scope

### Implemented (baseline)
- Three hand-authored, themed maps (station / Mars / urban) picked in the lobby, each seed-varied (tile/furnishing/scenery variation) with its own prop catalog (~29 station props)
- Public matchmaking plus code-protected private rooms with host-controlled map/start
- Lobby with map, avatar and weapon pickers, name + ready
- Complete round state machine (incl. `hiding` phase with hunters locked and blacked out)
- WASD movement + mouse look (hunter first person, prop third person), run and jump
- Random prop disguise with limited rerolls, manual rotation, fixed-radius movement collider and decoys
- Three hunter weapons, penalty on missed shot, server-derived shot origin, server-side hit resolution and infection model
- Mandatory taunt (positional audio + wiggle)
- `T` chat, `Tab` standings, kill feed, result screen + return to lobby
- Random animal avatars (cube-pets) per player
- Runtime-synthesized audio (Web Audio), shadows, persistent mute
- Spectator after a hunter self-eliminates
- Per-device lifetime rounds, wins, captures and survivals persisted in SQLite

### Phase 2 (unlocked by the structure, not now)
- More themes/catalogs; further art/polish
- Public leaderboards and richer between-round statistics
- Selectable skins/variants, emotes, manual taunts
- Reconnection and room persistence across server restarts
- Mobile/touch

### Non-goals (for now)
- Competitive-grade anti-cheat (non-authoritative movement, no server-side collision)
- In-game map editor
- Accounts/login

## 11. Risks & notes

- **Netcode**: latency is the real sensitive point; on LAN it's forgivable. Interpolation covers the MVP; serious lag compensation → Phase 2.
- **Client-side collisions**: the server only clamps to bounds, walls and furniture are client-side (player circle vs AABB/radius). Consequence: movement physics is not anti-cheat and must be treated as such.
- **Testable camouflage**: you need **variety** of props from the start — the three catalogs offer dozens of shapes across the maps, so the gameplay is evaluable right away.
- **Audio**: positional taunt is central to the balance and is already implemented (synthesized, no asset files).
