# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through
[GitHub's private vulnerability reporting](https://github.com/radonforge/morphy/security/advisories/new),
or by email to [privacy@radonforge.com](mailto:privacy@radonforge.com).

Tell us what is affected, how to reproduce it and what an attacker gains. We are two people
working on Morphy in our spare time: we aim to reply within a week and will keep you posted
until it is fixed. Only the latest release, the one running at
[morphy.radonforge.com](https://morphy.radonforge.com), is supported.

Please test against your own local server (`pnpm dev`), not the public one, and never against
other players.

## In scope

- The game server: room messages, the HTTP endpoints (`/stats`, `/player-counts`), anything that
  crashes the process, takes over another player's seat in a room, or reads data the server
  should not hand out.
- The client: script injection through names, chat or any other text another player controls.

## Known and accepted

These are deliberate trade-offs, documented in `AGENTS.md`, and not vulnerabilities:

- **Disguises are readable from the network state.** Every client receives each player's role,
  disguise and position, so a modified client can tell which object is a player. Hiding it needs
  per-player interest management, which costs more than it is worth at Morphy's scale today.
- **Movement is client-authoritative.** The server clamps positions to the map bounds and checks
  nothing else: no walls, speed or teleport limits, so a modified client can go anywhere inside
  the map. Hits, HP, roles and the round are decided by the server.
- **Identity is a device id, not an account.** Anyone who copies a browser's device id can see
  and reset its stats. There are no accounts and no passwords to steal.
