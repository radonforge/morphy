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
| `--visibility` | `limited` | `limited` \| `full`: what the bot is allowed to sense (`full` only against a local server) |
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
  props hide, and then only what a player's screen would show: the cone it
  faces at the default field of view (it glances aside now and then while it
  searches), never through a wall or a piece of furniture, though any part of a
  disguise that shows is enough. A contact seen to wear no disguise is a teammate and is left
  alone, and every disguise in sight (a still prop, a decoy, or the scenery
  itself) looks the same until it gives itself away by moving, changing shape
  or honking. A suspect in reach is shot at, standing still or running, one
  out of reach is chased down, and with no suspect it tests the nearest object it has not tried by
  shooting it, every few seconds, paying the miss damage when it was furniture.
  A probe that went past the object tested nothing, so it tries that one again
  after `BOT_PROBE_RETRY_MS`.
  A prop's rustle out of sight is a spot to investigate, not a contact it can
  follow, and says nothing of who made it; a spin makes no sound, and nobody
  hears a hunter's footsteps, bot or player. A
  taunt it hears is run to, and with nothing to follow for a while it sounds
  its sonar.
- **Prop**: hides as the object it was dealt (it never rerolls). From the map
  alone (`policy/hiding.ts`, never where anyone else is) it scores spots beside
  objects of its own kind, turned like them, where the shape belongs by its
  asset tags (a wall-mounted one backed onto a wall), in cover from the open
  ground and the hunter spawns, with a way out, never in a doorway's clearance
  (the one the level checks keep furniture out of), and draws one among the
  good ones so it does not take the same spot every round; a spot it cannot
  step onto, a decoy standing there, it gives up for another. It walks there with its
  disguise facing the way it was dealt and turns it once it stands there, never
  with a hunter in sight. In the hunt a hunter merely looking its way from a
  distance keeps it still; one aiming at it from point blank, one closing in
  while it keeps it in sight, or one that watched it move or honk a moment ago
  sends it running to the waypoint that best breaks sight of every hunter it
  perceived (`policy/escape.ts`), committed for a while and for as long as a
  hunter stays on it, then it hides again after a calm. It drops a decoy on its
  hiding spot as it breaks cover, keeping the last one for a hunter at point
  blank, and ignores rustles, which only props make. It sees all round, as a
  player's camera orbits a disguise, but not through walls or furniture. It
  taunts on the hunt's clock (first 8 to 15 s in, then a draw past each
  cooldown, ahead of the forced honk), from its spot and never with a hunter in
  sight, and moves to a new spot after a honk it did not choose: the room's
  forced one, or one a sonar drew.

Movement integrates at `MOVE_SPEED` (times `RUN_MULTIPLIER_HUNTER` or
`RUN_MULTIPLIER_PROP` while running) with the client's wall/furniture push-out,
so bots stay inside the map and out of the scenery.

**`--visibility limited` is the default and the production-equivalent mode**: a
live room runs its bots at `limited` too (`MorphyRoom.ts`), where the bot senses
only what a player reads off the screen. `full` reads `role` / `alive` /
`propType` as ground truth. It is a measuring anchor, not a way to play, so the
CLI refuses it unless `--url` points at this machine (`localhost`, `127.x.x.x`
or `[::1]`).

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
`BOT_FILL_TARGET`, at least `MIN_PLAYERS_TO_START`) server-driven bots at
`DEFAULT_DIFFICULTY` with limited vision. `Math.random` is seeded from `--seed`, so the same seed replays the
same rounds. It prints one Markdown row per map: prop win rate, median and p90
hunt (from the hunt opening to the round's end, so a prop win counts the full
round), shots per capture, the share of captures on a prop moving when the
shot landed (read off its latest input), the share on one that had moved within
`MOVED_RECENTLY_MS` (which also counts a prop that had just stopped), captures
per round, how often a hunter ran its HP out, and the wall time one bot tick
costs during the hunt (mean and p99). A second table judges the props from
ground truth the bots never see: the share no hunter spawn sees as the hunt
opens, how exposed their spots are to the open ground round them, the share
that finished hiding in time, objects of their own type within 3 m and the
share turned like one, the median time to a prop's first taunt of its own, the
share of honks a prop outlives by 10 s, decoys hunters shot, and chases with
the run/stand switches in each. It is not part of
`pnpm test`; run it before and after a change to bot behaviour or pacing.
