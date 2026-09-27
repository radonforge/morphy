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

- **Hunter**: picks a target within an engage range and fires *only when it
  predicts a server-side hit* (same raycast as `MorphyRoom`), so it never bleeds
  HP on walls. Difficulty widens its sight and shortens its reaction time. Under
  `--visibility limited` it has no `role` to read and sees nothing while the
  props hide: a contact seen to wear no disguise is a teammate and is left
  alone, and every disguise in sight (a still prop, a decoy, or the scenery
  itself) looks the same until it gives itself away by moving, changing shape
  or honking. A suspect standing still is shot, one still moving is chased
  down, and with no suspect it tests the nearest object it has not tried by
  shooting it, every few seconds, paying the miss damage when it was furniture.
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
