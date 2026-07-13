# morphy.lol

Browser multiplayer prop hunt. Low-poly 3D, LAN-first. See [`SPEC.md`](./SPEC.md) for the design.

## Requirements

- Node ≥ 20
- pnpm

## Setup

```bash
pnpm install
```

## Development

```bash
pnpm dev
```

Starts the game server (Colyseus, port `2567`) and the client (Vite, port `5173`) in parallel.
Open the client at the URL printed by Vite (default `http://localhost:5173`).

To start them separately:

```bash
pnpm dev:server
pnpm dev:client
```

## Checks

```bash
pnpm typecheck   # tsc --noEmit across all packages (the only required gate)
pnpm check       # Biome lint + format check
```

## LAN play

1. The host runs `pnpm dev`. Vite serves on the local network (`host: true`) and proxies
   `/colyseus` — WebSocket included — to the game server on `:2567`.
2. Teammates open `http://<host-ip>:5173` (e.g. `http://192.168.1.42:5173`); the client reaches
   the server through the proxy, with no extra configuration.
3. To point at a separate/standalone server instead, set `VITE_SERVER_URL`
   (see `packages/client/.env.example`).

## Remote play

```bash
pnpm tunnel
```

Runs ngrok on `5173`, exposing a single tunnel that covers both the client and the WebSocket.
Set `NGROK_DOMAIN` to use a reserved domain.

## Status

Playable: lobby with map + avatar pickers and name + ready; full round state machine
(`lobby → starting → hiding → hunting → round_end`); server-authoritative roles, HP, shooting
(infection capture) and win conditions; client-side movement + collision; prop morphing; chat,
standings and kill feed; runtime-synthesized audio. See `SPEC.md` §10 for the roadmap.
