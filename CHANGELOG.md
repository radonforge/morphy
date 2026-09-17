# Changelog

All notable changes to Morphy are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(0.x releases are pre-1.0).

## [Unreleased]

### Changed

- A shared link previews as the key art instead of a favicon: `og:image` is the
  1600×800 showcase banner and `twitter:card` is `summary_large_image`, where
  before the card was a small square of the maskable app icon — the variant
  padded for Android icon masking, and the wrong one to hand a scraper. The
  card also carries `og:url`, `og:site_name`, the image dimensions and alt
  text, so a crawler can lay it out without fetching the image first.

## [0.3.0] — 2026-09-16

The avatar is no longer picked from a grid: you click the pet on the stage and
morph through the catalog in place, with the same burst a real disguise change
fires. The menu is rebuilt as glass and reaches first paint at a quarter of the
weight. A long frame or a shove no longer pushes the player through a wall, and
the bots stop stalling — a failed path, a lost sighting, a cornered flight and
a hide spot behind a wall each had their own way of parking one in place.

### Added

- The avatar is chosen by morphing through the catalog on the lobby stage.
  Clicking the pet dollies the camera in, and the catalog steps with the arrow
  keys, the wheel or the rail arrows; every step fires the materialize burst
  and the morph cue the game already plays for a real disguise change. The
  neighbours either side render as the actual GLBs under an additive override,
  which doubles as the preload — so the next morph is warm, and a cold model
  loads under cover of the beam instead of leaving a hole. The Identity pane
  keeps the callsign, written once where the avatar changes often, and trades
  its grid of twenty-one emoji for a Change avatar button. Clicking anywhere
  outside the rail closes the picker, and the hint that says so sits in a
  click-through dock, so neither it nor the gap around it forms a dead strip
  above the backdrop.
- The lobby panels are a glass surface. The old chamfer was a `clip-path`,
  which clipped every shadow to the box and made elevation impossible; a
  radius instead lets the surface carry a contact shadow, an ambient one and a
  specular rim. Geometry now says what a thing does — round is passive glass,
  chamfered is hardware you can actuate — so the map cards keep their chamfer
  on a surface of their own. The glass takes a per-map tint because mars and
  urban sit under bright skies: worst case, with full sky behind a panel and
  the sheen hotspot on it, body text holds 6.5:1 on mars and 6.8:1 on urban,
  against 11.4:1 on station.

### Changed

- The menu no longer loads the 3D stack before it can paint. The route split
  deferred almost nothing, because the lobby stage imports three and
  react-three eagerly and the entry chunk carried all of it: 419 kB gzip to
  first paint, against 115 kB now that the stage loads lazily over the
  background the menu CSS already draws.
- The combat HUD sits on a flat surface instead of the glass. Glass is for
  when the game is waiting on you, not for reading your health under fire.

### Fixed

- The frame the client integrates is bounded, so coming back to a backgrounded
  tab no longer flings the player across the map. `requestAnimationFrame`
  stops while a tab is hidden and the clock does not, so the first frame back
  integrated the whole pause in one step, held input and all. Capping the
  frame also caps one step's displacement, which is what keeps collision sound
  when the integrator only tests where a step lands.
- Collision puts the body back against the face it came in by, instead of the
  side it ended up nearest. Judging by the landing point put a body on the far
  side of anything it had overshot the midline of — reachable by a long frame,
  and by the shove that separates two players, which no frame cap bounds. The
  movement and collider code is now a pure module with tests that pin that
  margin against the real maps, so a prop thin enough to slip through fails
  the suite instead of the player walking through a wall.
- Held keys are released when the window loses focus. A window that loses
  focus never delivers the matching keyup, so a key held while switching away
  stayed held on return and the player kept walking. Each action is now
  derived from the set of held codes, which also fixes W and ArrowUp clearing
  one another: releasing either used to drop the action while the other was
  still down.
- The weapon on screen is the one the server resolves hits with. The local
  pick was React state seeded from the default, so any remount — a reconnect,
  or coming back from the party screen — reset the viewmodel, the cooldown and
  the shot audio to the pistol while the server kept firing the real weapon.
- The morph burst plays around the player rather than at floor level. The
  effect and the remote pose cache carried only x and z, so a disguise changed
  mid-jump or on a crate fired the beam and its shards under the player.
- A taunt pulse expires on time instead of waiting for the mesh that owns it.
  The pulse stored the time it had left and was decremented by the player's
  own mesh, so one interrupted by a leave or a death stayed positive with
  nobody to consume it — and any positive value reads as motion, which pinned
  the shadow map to a per-frame refresh for the rest of the session.
- A refused pointer lock is handled where the scene asks for it. The browser
  declines the lock routinely, and the refusal arrives as a promise rejection.
- The avatar stays on stage when the picker opens, the camera damps onto its
  new aim instead of cutting to it, and the wheel steps once per gesture on
  whichever axis the gesture opens on — a sideways trackpad swipe never
  reached the carousel at all, and inertia went on stepping after the gesture
  ended. The stage's frame-rate boost is bounded to the frames that move.
- A bot no longer reads a failed path plan as an arrival. A failed plan and a
  fully walked one both leave the follower empty, so a goal behind a wall
  settled on the first tick — and settling stopped the replan counter, so the
  blocked-path signal never rose and the policy kept re-issuing the spot.
- A bot's motor stays inside the bot's own senses. The reflex ran an intent
  for a whole decision cycle against the room's live players, so a target that
  broke line of sight was still pathed to by its true coordinates. The motor
  now shares the observation's sight and hearing gate, and falls back to the
  last position it was entitled to see.
- A fleeing prop keeps running. Recomputing the escape point on every decision
  let a cornered prop re-issue a goal that drifted past the arrival epsilon,
  resetting the replan counter so the blocked path never latched — measured at
  52 decisions per ten seconds against a cadence of fourteen, with the prop
  glued in place. Holding the point exposed the other half: the reflex parks
  on a goal it has arrived at and the policy kept re-issuing that same goal,
  which the driver reads as no change, so a prop that reached its escape point
  stood there for the rest of the round. Arrival now reaches the policy
  through the observation, and a blocked escape swings to a new angle.
- A prop caps how often it re-picks a hide spot it cannot reach. A blocked
  path wakes the policy off-cycle, so clearing the plan on every blocked
  decision let a bot sealed off from every nearby prop cycle at nearly seven
  times the ordinary decision rate; after a bounded number of tries it hides
  where it stands.
- A motionless contact no longer sounds like a noise. A first sighting
  recorded the moment it was seen as the moment it last moved, so any second
  observation inside the recently-moved window reported a contact that had
  never moved as audible — and event-driven decisions land well inside that
  window. Samples and remembered positions are dropped when a player leaves
  the room.
- A hunter runs down a disguise it has seen fleeing instead of walking after
  it. It is gated on a contact seen disguised and moving: a noise could be a
  teammate, and sprinting at every one rebuilds the hunter pack.
- A room's bot fill stops at the first bot it cannot seat. Every bot in a room
  takes the same map, so one a driver rejects none will accept: the loop asked
  forever, and being synchronous it pinned the event loop and took every other
  room on the process down with it.

## [0.2.5] — 2026-09-11

A public lobby now says what it is waiting for instead of going quiet until
three bots land at once. iOS stops framing the page in white, and the notice a
phone gets says its piece in one line.

### Added

- A public lobby counts down the wait for its bots. The room pads itself to
  four presences ten seconds after someone arrives, but the auto-start clock
  only arms once there are enough players to start, so a player alone had no
  countdown at all for those ten seconds and then met three bots arriving
  together. The room now publishes that deadline and the lobby reads
  `Searching for players — bots join · 9s`, handing over to the auto-start
  clock as soon as there is one.

### Fixed

- iOS no longer shows a white band above and below the page. Every dark
  surface was painted by an absolutely positioned child, so the CSS canvas
  kept the user-agent default — and Safari both fills the safe areas with that
  colour and tints its own toolbar from it, which framed the page in white
  whatever `theme-color` asked for. The background and `color-scheme` now sit
  on the root itself, where a stray uncovered pixel cannot be white again.
- The desktop-only notice stops explaining itself. It spelled out why a
  browser withholds the pointer and which keys the game moves on, to a reader
  holding a phone who can act on neither.
- The lobby's player threshold counts only connected seats, the way the server
  does. A seat held open for a dropped player made the client say there were
  enough players to start while the server, which counts presence, would not.

## [0.2.4] — 2026-09-09

Hunter bots now tell a teammate from a disguise by shape, which ends the pack
0.2.3 only bounded at arm's reach. Morphy also turns away a device it cannot be
played on instead of leading it into a match, and the hunter's health bar is
readable again on a narrow window.

### Added

- Morphy asks to be opened on a PC when it is opened on a phone or a tablet,
  instead of showing a lobby that leads to a game those devices cannot run:
  aiming needs the pointer locked, which no mobile browser grants, and movement
  is on WASD. The test is a capability, not a width — `(pointer: fine)`, so a
  desktop window dragged narrow still plays and a tablet held wide does not —
  and it is re-evaluated live, so plugging in a mouse lifts the notice without
  a reload.

### Fixed

- A hunter bot no longer treats another hunter as something to identify. The
  0.2.3 inspect budget bounded the symptom at arm's reach and left the chase
  untouched: a contact that keeps more than two metres away never spends the
  budget, so a bot hunter followed a human hunter around the map for the whole
  round, and a pack re-formed every time a park expired. The cause was the one
  perception signal the policy had, `looksLikeProp`, which folded "wears a
  disguise" together with "is standing still" — leaving a moving disguise and
  an undisguised teammate indistinguishable. Perception now reports the shape
  itself (`ObservedEntity.disguised`, whether a contact wears a disguise, never
  which one — what a player reads off the screen), a hunter is excluded from
  suspect selection because it can only ever be a teammate, and the budget and
  its park are gone rather than kept alongside the fix. The shape is reported
  only for a contact in line of sight: footsteps through a wall tell a player
  nothing about who is making them, so a heard contact still gets investigated
  whoever it is. A prop bot reads a threat the same way — a seen disguise is a
  fellow prop and no reason to break cover, an unseen noise still is.
- The hunter's health bar no longer sits on top of the controls bar. Both were
  positioned from the bottom of the screen by hand, eight pixels apart in the
  wrong direction, and the controls bar wraps to two or three rows on a narrow
  window and buried the bar completely. They are now one bottom-centred stack,
  so the spacing holds however many rows the controls take.

## [0.2.3] — 2026-09-09

Hunter bots no longer deadlock on each other. A round that filled with bots
could stall completely: the hunters converged on one spot and stayed there,
leaving props unhunted until the timer ran out.

### Fixed

- A hunter bot gives up on a contact it cannot identify. Under `"limited"`
  visibility it picked the nearest sensed contact and walked up to it, and
  because a hunter is never disguised it can never come to look like a prop —
  so two hunters chose each other, met, and stayed there staring for the rest
  of the round, growing into a pack on every infection. An `inspect` that has
  stood at arm's reach in clear line of sight for six decisions now parks that
  contact and moves on. The budget only runs at contact range and in sight, so
  an approach, a chase, or a contact known only by sound is never cut short,
  and a park is released the moment the contact reads as a prop. Measured over
  a 150-second run of six bots: not one round finished before, three finished
  after, and the worst hunter went from 122 seconds pinned inside a 1.5-metre
  circle to 4.

## [0.2.2] — 2026-09-09

The lobby now names the build it is running: a tagged deploy shows the tag
itself, and any other build shows the release it sits past rather than claiming
to be it.

### Added

- The lobby shows the client's version and build under the wordmark, so a bug
  report can name the exact build it came from. A tagged build reads its
  version from the tag — `0.2.2 · 1a2b3c4` — which makes the tag authoritative
  rather than the manifest on disk. Every other build sits *past* a release
  instead of being it, and says so: `0.2.1+ · a49e58f`. That distinction is
  what earns the stamp its place, because production also deploys on
  `workflow_dispatch`, so one version can ship from more than one commit. A
  build made outside a checkout reads `dev` rather than claiming a commit.

## [0.2.1] — 2026-09-08

Fairness release: a room-filling bot no longer knows anything a player could
not, a decoy no longer gives itself away on the wire, and the hunter's weapon
points downrange instead of at its owner.

### Changed

- Room-filling bots play with a player's information instead of the server's.
  They ran on the `"full"` visibility mode, which reads `role`, `alive` and
  `propType` straight off every contact — a bot hunter never had to *find* a
  prop, it targeted the disguise through the disguise. They now run `"limited"`:
  line of sight, distance, and whether a contact moved recently. `"full"`
  remains as a measuring anchor and is not wired into any live room.
- A bot also no longer gets a privileged *reaction time*: the trigger that woke
  its policy early filtered contacts by `role`, so it slept through a teammate
  and woke the instant an enemy entered its line of sight — decided before the
  policy had been shown anything about either. It now wakes for any contact that
  comes into view, and works out who they are from the observation it is allowed
  to see.
- A bot no longer gets a heard contact's exact coordinates. A contact sensed by
  sound alone — moving within earshot, with no line of sight — is reported at a
  4 m cell rather than a point, and its distance is derived from that cell, so a
  noise through a wall becomes a neighbourhood to search instead of a
  destination to walk onto. A contact actually in view is still exact. This was
  the last place a filling bot knew something a player could not.

### Security

- A decoy no longer travels with its owner on it. `DecoyState.owner` was a
  broadcast schema field, so any client could read which props in the room were
  fake and whose they were — and deception is the whole point of the mechanic.
  The server still tracks it to expire a player's decoys; the owner now learns
  which decoy is theirs from a `decoy_placed` ack sent to them alone.

### Fixed

- The hunter's weapon pointed backwards. The first-person viewmodel carried a
  180° yaw, but every blaster in the kit is authored with its muzzle along `-Z`
  — already the direction a three.js camera looks — so the correction turned the
  gun around and aimed it at the player. Present since the viewmodel was added.

### Removed

- The `parseIntent` / `parseObservation` validators in `shared/agent.ts`. They
  guarded output from an out-of-process agent policy that does not exist — the
  server drives its bots in-process — so `parseObservation` had no caller at all
  and `parseIntent` only had a test. The contract is types only now.

## [0.2.0] — 2026-09-08

A public match is now playable alone and leavable from every screen: rounds
start on their own, bots fill a quiet room, a lost connection no longer costs
the round, and a room's own failure no longer takes the server down with it.

### Added

- A match menu on `Escape` during a round, with `Leave match`, plus a leave
  button on the results screen and in the public lobby overlay. Leaving a match
  was previously only possible by reloading or closing the tab.
- Public rounds start on their own: reaching the minimum player count arms a
  20 s clock, and `Ready` now shortens that clock instead of authorising the
  start, so one idle player can no longer hold a lobby hostage.
- Quiet public rooms pad themselves with server-driven bots after 10 s and hand
  a bot's seat back the moment a human joins, so a lone player still gets a
  match. Private rooms are never filled.
- Losing the connection mid-round no longer costs the round: the seat, role and
  position are held for 30 s while the client rejoins, and the scoreboard shows
  the player as `Reconnecting…` in the meantime. A round that outlives the
  window ends exactly as an abandoned one always did. Leaving on purpose is
  still immediate.

### Changed

- The name shown to players is now `Morphy`, with no TLD: browser title, Open
  Graph title, PWA install name and the lobby wordmark. The game has never been
  served from `morphy.lol` and there are no plans to buy it, so the brand no
  longer names a domain it does not own. Stored player prefs are untouched — the
  `morphy:` localStorage namespace already carried no TLD.
- Quick play pools everyone into the busiest room instead of splitting the pool
  three ways by map. The lobby's map pick now only decides the map of a newly
  created room; private rooms are unaffected.
- A round interrupted below the minimum player count awards the win to the
  player left in it, instead of ending without touching anyone's record.

### Fixed

- A throw inside a room's own clock callback — a phase timer, the 2 s ping
  interval, a bot's brain — no longer exits the server process and takes every
  other match down with it. Failures inside message handlers, previously
  swallowed silently, are now logged (without their payloads).
- The match menu no longer paints over the results screen at the end of a round,
  and no longer leaves chat, weapon-switch and mute keys live underneath itself.
- Bots no longer inherit the host seat when the last human leaves a filled room,
  and no longer deliver a chat line a round after they meant to say it.

### Removed

- The `morphy.smyile.com` redirect and its tunnel route. The old host no longer
  resolves, so links that predate the move now fail at DNS instead of landing on
  the game.

## [0.1.1] — 2026-09-07

Infrastructure release: the game moved to its own domain under the Radon Forge
org, and the deployed edge config caught up with what 0.1.0 had claimed.

### Security

- The nginx security headers (`X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`) now reach the HTML document and the
  static assets. nginx only inherits `add_header` where a level declares none of
  its own, so the four locations that set `Cache-Control` had been silently
  dropping them.
- Transitive dependencies refreshed to clear four advisories (`nanoid`,
  `postcss`, `qs`, `fflate`). None was reachable from this deployment.

### Added

- `LICENSE`: proprietary, copyright Radon Forge.

### Changed

- The game moved to `morphy.radonforge.com`. The old host answers `301` with the
  path and query preserved, so existing links keep working.
- **Lifetime stats restart from zero.** They are keyed by a device id kept in
  browser storage, which is scoped to the origin and therefore does not follow
  the move; the stored rows survive but no longer match any player.
- Production ships on a version tag (`v*`) or a manual dispatch, no longer on
  every push to `master`. CI still runs on pushes and pull requests.
- The `ci` script is now `check:ci`: pnpm has its own built-in `ci` command,
  which shadowed the script and ran a clean reinstall instead of Biome.

### Fixed

- The deployed nginx config now applies the model and sound revalidation policy
  that 0.1.0 claimed: the live file had kept the year-long `immutable` headers,
  so a deploy could not invalidate a changed GLB.

## [0.1.0] — 2026-07-21

First tracked release: server-authority hardening, a slimmer asset pipeline,
and the initial automated test suite.

### Security

- Hit resolution derives the shot origin from the authoritative server-side
  player position + eye height; the client no longer sends an origin, closing a
  shoot-through-walls vector.
- Weapon-id validation uses own-property checks, rejecting prototype-chain values.

### Added

- Automated test suite (20 tests) across validators, map generation, geometry,
  storage, endpoints, bot scheduling and room lifecycle; CI runs the tests and
  the production build.

### Changed

- Runtime assets are fingerprinted by a Vite manifest plugin that prunes
  unreferenced models from the build (~558 → 135 GLBs shipped).
- The game route is lazy-loaded; menu/HUD state is driven by schema listeners
  instead of a 200 ms poll.
- Map validation rejects non-finite numbers, empty spawn lists and duplicate ids.
- Production deploys pin the immutable commit-tagged server image.

### Fixed

- localStorage is guarded with an in-memory fallback; device ids fall back to
  `getRandomValues` on insecure LAN origins.
- The stats endpoint follows `VITE_SERVER_URL` instead of the page origin.
- Weapon cooldown is tracked as an absolute timestamp, so switching weapons
  mid-cooldown no longer shortens the fire window.
- Joining or leaving mid-round no longer corrupts the round; disconnects
  re-check the win condition.
- Public model and sound assets revalidate after a deploy instead of being
  cached for a year.
- Lobby music retries after a transient playback failure.
