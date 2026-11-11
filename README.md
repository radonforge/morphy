<p align="center">
  <img src="packages/client/public/banner.jpg" alt="Morphy, multiplayer prop hunt: a fox morphing into a barrel while an armed hunter closes in on a space station" width="100%">
</p>

<h3 align="center">Hide as anything. Hunt everything.</h3>

<p align="center">
  A multiplayer prop hunt that runs in the browser: low-poly 3D, up to 12 players,<br>
  no install and no account.
</p>

<p align="center">
  <a href="https://morphy.radonforge.com"><strong>Play now</strong></a>
  &nbsp;·&nbsp;
  <a href="https://morphy.radonforge.com/changelog">What's new</a>
  &nbsp;·&nbsp;
  <a href="CONTRIBUTING.md">Contribute</a>
  &nbsp;·&nbsp;
  <a href="AGENTS.md">Architecture</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-3b82f6?style=flat-square"></a>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="three.js" src="https://img.shields.io/badge/three.js-r184-049ef4?style=flat-square&logo=threedotjs&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react&logoColor=white">
  <img alt="Colyseus" src="https://img.shields.io/badge/Colyseus-0.17-f59e0b?style=flat-square">
  <img alt="Node 24 or later" src="https://img.shields.io/badge/node-%E2%89%A524-5fa04e?style=flat-square&logo=nodedotjs&logoColor=white">
</p>

---

## How it plays

Every round splits the room in two. **Props** get 15 seconds to disguise themselves as something
on the map and find a spot where they blend in. Then the **hunters** are released and have three
minutes to find them.

- **A caught prop joins the hunt.** Every hit turns a prop into a hunter, so the hunting pack grows
  as the round goes on. Props win by lasting until the clock runs out.
- **Missing costs you.** A hunter who shoots furniture loses health, so firing at everything is
  not a strategy.
- **Props fight back with tricks.** Swap to another disguise, turn to line up with the objects
  around you, drop a decoy, or taunt for points: the closer the hunter, the more it pays.
- **Hunters have a sonar** that makes every prop nearby honk. Decoys stay silent.
- **Quiet rooms fill up with bots** that play by what a player can see, and leave as soon as a
  real player joins. Party codes give you a private room with your friends.

## Maps

| Map | The place | Hide as |
| --- | --- | --- |
| **North District** | Courtyards round a city park, by golden hour or by night under the street lamps | Trees, planters, parasols, cones, dumpsters |
| **Kepler-9 Station** | Pressurized modules and tight corridors under glass ceilings open to the stars | Containers, chairs, tables, computers, barrels |

## Controls

<table>
<tr><th>Everyone</th><th>Hunter</th><th>Prop</th></tr>
<tr valign="top">
<td>

<kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>&nbsp; Move<br>
<kbd>Shift</kbd>&nbsp; Run<br>
<kbd>Space</kbd>&nbsp; Jump<br>
<kbd>T</kbd>&nbsp; Chat<br>
<kbd>Tab</kbd>&nbsp; Standings<br>
<kbd>Esc</kbd>&nbsp; Match menu

</td>
<td>

Left click&nbsp; Shoot<br>
<kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd>&nbsp; Switch weapon<br>
<kbd>F</kbd>&nbsp; Sonar

</td>
<td>

<kbd>R</kbd>&nbsp; Random disguise<br>
<kbd>Q</kbd> <kbd>E</kbd>&nbsp; Turn the disguise<br>
<kbd>X</kbd>&nbsp; Turn mode<br>
<kbd>C</kbd>&nbsp; Drop a decoy<br>
<kbd>V</kbd>&nbsp; First or third person<br>
<kbd>F</kbd>&nbsp; Taunt

</td>
</tr>
</table>

## Quick start

You need Node 24 or later and pnpm 11 (`corepack enable` installs the pinned version).

```bash
pnpm install
pnpm dev
```

That starts the game server on `:2567` and the client on [localhost:5173](http://localhost:5173).
Pick a map and press Play: a quiet room fills itself with bots after a few seconds. To bring
your own instead:

```bash
pnpm bot -- -n 3
```

### Play with friends

- **Same network:** run `pnpm dev` and have your friends open `http://<your-ip>:5173`. Vite
  serves on the LAN and proxies the game server, so there is nothing else to set up.
- **Over the internet:** `pnpm tunnel` opens an ngrok tunnel to the client, WebSocket included.
  Set `NGROK_DOMAIN` to use a reserved domain.
- **Separate server:** point the client at it with `VITE_SERVER_URL`
  (see `packages/client/.env.example`).

## Under the hood

The server is authoritative for everything competitive: rounds, roles, health and every hit.
Clients move themselves and the server keeps them inside the map.

| Package | What it does |
| --- | --- |
| [`packages/client`](packages/client) | React and react-three-fiber: the 3D scene, menus, HUD and audio, built with Vite |
| [`packages/server`](packages/server) | The Colyseus room: round state machine, hit resolution, bot fill and lifetime stats in SQLite |
| [`packages/shared`](packages/shared) | The contract both sides agree on: tuning constants, network messages, map model and geometry |
| [`packages/level`](packages/level) | Maps as documents: compiler, layout checks and the edit operations behind `pnpm level` |
| [`packages/bot`](packages/bot) | The bots: perception, navigation, aiming and hiding, shared by the server and the CLI |

Maps are edited, not generated: `pnpm level` reads and edits them from the terminal, and the dev
server has a map editor at [localhost:5173/#editor](http://localhost:5173/#editor).
[AGENTS.md](AGENTS.md) explains how it all fits together.

### Checks

CI runs these on every pull request:

```bash
pnpm check:ci    # Biome lint and format
pnpm typecheck   # tsc across every package
pnpm test        # node:test over the real modules
pnpm --filter @morphy/client build
```

## Contributing

Bug reports, ideas and pull requests are welcome: start with [CONTRIBUTING.md](CONTRIBUTING.md).
Report security issues privately, as [SECURITY.md](SECURITY.md) describes.

## License

The code is [MIT](LICENSE). The Morphy name and logo, the official instance's legal pages and the
third-party models and audio are not: [COPYING.md](COPYING.md) lists what is covered by what. The
3D models and sound effects are by [Kenney](https://kenney.nl) (CC0).

<p align="center">
  Made by <a href="https://radonforge.com">Radon Forge</a>
</p>
