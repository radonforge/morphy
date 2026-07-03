# @webhunt/bot

Headless autonomous players for webhunt.lol. They connect to a running Colyseus
server exactly like the browser client (`@colyseus/sdk` over `ws`, no rendering),
auto-ready in the lobby, and play whatever role the server assigns each round —
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
| `--name` | animal pool | name prefix, e.g. `--name Drone` → `Drone1`… |
| `--ready-at` | `count + 1` | players present before bots ready up |
| `--code` | — | join a private party room by code instead of matchmaking |

Bots default to readying only once **one more player than the bot count** is in
the room, so a round never auto-starts without you. Pass `--ready-at <count>` to
let bots play on their own (handy as a server smoke test).

`Ctrl-C` leaves all rooms cleanly.

## How it plays

- **Hunter** — scans for live props within an engage range, and fires *only when
  it predicts a server-side hit* (same raycast as `WebHuntRoom`), so it never
  bleeds HP on walls. Difficulty widens its sight and shortens its reaction time.
- **Prop** — picks a prop type that exists in the scene, hides next to a matching
  cluster, transforms, holds still, and bolts if a hunter gets close.

Movement integrates at `MOVE_SPEED` with the client's wall/furniture push-out, so
bots stay inside the map and out of the scenery.
