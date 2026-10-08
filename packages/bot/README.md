# @morphy/bot

Headless autonomous players for Morphy. They connect to a running Colyseus
server exactly like the browser client (`@colyseus/sdk` over `ws`, no rendering),
auto-ready in the lobby, and play whatever role the server assigns each round,
switching behaviour on the fly when a prop gets converted to a hunter.

## Run

Start the server first (`pnpm dev:server` or `pnpm dev`), then:

```bash
pnpm bot                      # 3 bots, localhost, difficulty 0.6
pnpm bot -- --count 5 -d 0.8  # 5 harder bots
```

Flags (after `--` when invoked through the root script):

| Flag | Default | Meaning |
|---|---|---|
| `--count`, `-n` | `3` | how many bots to spawn |
| `--difficulty`, `-d` | `0.6` | `0`–`1`: engage range + reaction speed |
| `--url` | `ws://127.0.0.1:2567` | server URL (or `BOT_SERVER_URL` env) |
| `--name` | built-in pool | name prefix, e.g. `--name Drone` → `Drone1`… |
| `--ready-at` | `count + 1` | players present before bots ready up |
| `--code` | no default | join a private party room by code instead of matchmaking |
| `--map`, `-m` | `urban` | map of a *newly created* room (`urban`, `station`) |
| `--policy` | `scripted` | which policy drives the bots |
| `--visibility` | `full` | `full` \| `limited`: what the bot is allowed to sense |
| `--trace` | no default | base path for per-bot JSONL traces of every applied decision |

Bots default to readying only once **one more player than the bot count** is in
the room, so a round never auto-starts without you. Pass `--ready-at <count>` to
let bots play on their own (handy as a server smoke test).

`Ctrl-C` leaves all rooms cleanly.

## How it plays

- **Hunter**: picks a target within an engage range and fires only with a clear
  shot at it (same raycast as `MorphyRoom`), so it never wastes a shot on a
  wall, but it aims like a player (`src/aim.ts`): its crosshair wanders a little
  round the target, a new target is flicked onto (now and then past) and fired
  at only after a reaction time drawn for it, the trigger is pulled with a
  chance that falls as the crosshair strays, and each shot leaves with an error
  that grows with how fast the target crosses its view, how far it is and how
  fast the hunter was moving. So it misses a runner far more than a crate
  standing still, and pays the miss damage a player pays. Difficulty widens its
  sight, shortens its reaction time and tightens its aim. Under
  `--visibility limited` it has no `role` to read and sees nothing while the
  props hide: a contact seen to wear no disguise is a teammate and is left
  alone, and every disguise in sight (a still prop, a decoy, or the scenery
  itself) looks the same until it gives itself away by moving, changing shape
  or honking. A suspect in reach is shot at, standing still or running, one
  out of reach is chased down, and with no suspect it tests the nearest object it has not tried by
  shooting it, every few seconds, paying the miss damage when it was furniture.
  A probe that went past the object tested nothing, so it tries that one again
  after `BOT_PROBE_RETRY_MS`.
  A contact known only by sound is investigated whoever it turns out to be. A
  taunt it hears is run to, and with nothing to follow for a while it sounds
  its sonar.
- **Prop**: picks a prop type that exists in the scene, hides next to a matching
  cluster, transforms and holds still. With a hunter in plain sight it keeps
  holding still, since moving is what gives a disguise away, and bolts only when
  that hunter is on top of it or when it only hears one close by, dropping a
  decoy where it stood. Once hidden it taunts for points now and then, never
  with a hunter in sight. A sonar pulse close by sends it running; one further
  off keeps it still and quiet.

Movement integrates at `MOVE_SPEED` (times `RUN_MULTIPLIER_HUNTER` or
`RUN_MULTIPLIER_PROP` while running) with the client's wall/furniture push-out,
so bots stay inside the map and out of the scenery.

**`--visibility limited` is the production-equivalent mode.** The CLI defaults to
`full`, which reads `role` / `alive` / `propType` as ground truth, while a live
room runs its bots at `limited` (`MorphyRoom.ts`), where the bot senses only what
a player reads off the screen. `full` is a measuring anchor, not a way to play,
so a bug reachable only under limited vision will not reproduce under the
default.

`--trace <path>` writes one JSONL file per bot, one line per *applied* decision
(`{t,botName,policy,seq,phase,visibility,obs,intent}`), plus a `kill` line for
every kill broadcast in the room and a terminal `round_end`. It is the practical way to measure what a bot actually did.

## Measuring bot-only rounds

```bash
pnpm bot:sim                          # 60 rounds on each map, seed 1
pnpm bot:sim --rounds 200 --map urban --seed 7
```

`pnpm bot:sim` (`tools/bot-sim/sim.mjs`) plays bot-only rounds in the real
`MorphyRoom` on a virtual clock, so a three-minute round takes as long as its
ticks take to compute (100 rounds on both maps run in well under a minute).
The room is filled the way a quiet public room fills itself: `--bots` (default
`BOT_FILL_TARGET`) server-driven bots at `DEFAULT_DIFFICULTY` with limited
vision. `Math.random` is seeded from `--seed`, so the same seed replays the
same rounds. It prints one Markdown row per map: prop win rate, median and p90
hunt (from the hunt opening to the round's end, so a prop win counts the full
round), shots per capture, the share of captures on a prop that was moving,
captures per round, and how often a hunter ran its HP out. It is not part of
`pnpm test`; run it before and after a change to bot behaviour or pacing.
