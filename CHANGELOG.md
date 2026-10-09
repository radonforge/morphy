# Changelog

Every Morphy release and what it changed for you, newest first.

## [Unreleased]

### Added

- Kill cam: a caught prop sees the last three seconds replayed through the
  hunter's eyes, slowing down into the shot that got them, before the caught
  card. Space skips it.

### Changed

- The card a caught prop sees now also says "You're a hunter now", so the
  switch to hunting is clear before the hunt call.

### Fixed

- A decoy dropped beside a wall or a building no longer shoves you into it. You walk
  out of a fresh decoy and it turns solid behind you.

## [0.4.2] - 2026-10-08

Bot props that hide like players. They pick a spot beside objects of their own
kind, turn to match them, and run when a hunter closes in.

### Changed

- Bot props hide like the objects around them, turn to match them and run when
  cornered instead of freezing in front of you.

## [0.4.1] - 2026-10-08

Bots that play fair and props that see more. Bot hunters see only what is in
front of them, cannot see through furniture and shoot at a prop that runs. The
menu shows who is playing each map, and props get a first person view, a closer
camera and a turn step.

### Added

- Each map in the menu shows how many people are playing it right now, so you
  can pick the map where the others are.
- A field of view slider in the lobby options and the match menu, from 50 to
  70 degrees, that changes the view as you drag it.
- Props can press V to look out from their disguise in first person, and press
  it again to go back to the camera behind them. The choice is remembered.

### Changed

- Bots no longer see behind them or through furniture: a bot hunter sees only
  what is in front of it, looking round as it searches, and a cabinet hides you
  from a bot as it hides you from a player. Bots also stopped hearing hunters'
  footsteps, which players never hear either, and a prop turning in place makes
  no sound for them.
- Bot hunters now shoot at a prop they see running instead of waiting for it to
  stop, and miss far more doing it: they aim like a player, a little late and a
  little off, and a miss costs them health as it costs you.
- As a prop, a tap of Q or E now snaps your disguise to the next 90, 45 or 15
  degree mark, the step you choose, and holding the key spins it as before.
  Press X to switch the step; the choice is remembered.
- The controls bar at the bottom of the screen now shows only your role's own
  actions and fits on one line. Every other key is in All controls, behind ?.
- The Graphics quality choice in the options is now a dropdown in the game's
  own style. It works with the arrow keys, Enter and Escape, typing the first
  letters of an option picks it, and it stays inside a short window instead of
  opening off screen.
- The camera behind a prop now sits closer and lower, and frames your disguise
  by its size: further back for a dumpster, nearer for a cone. Scroll the mouse
  wheel to pull it in or out. On screens wider than 16:9 the view no longer
  stretches sideways, and sprinting widens it less.
- While the list of controls behind ? is open, your keys and mouse no longer
  move, aim or act in the match behind it.

## [0.4.0] - 2026-10-07

Two maps, back-to-back rounds and a much louder catch. North District is rebuilt
as a park ringed by courtyards and plays by day or by night, Kepler-9 is a
night station with a new layout, and Ares Outpost is gone. Hunters get a sonar,
props get a taunt, and bots now play with only what a player could see. The
menu opens on one slice per map, and the game has changelog, privacy and terms
pages.

### Added

- North District is a new map: four courtyards around a central park, with
  hunters starting at the town gates. Each round is drawn by day or by night,
  with glowing street lamps and lit windows after dark.
- Kepler-9 is a night station with starlight, glowing deck lamps and a glass
  ceiling. It is relaid as thirteen rooms around a central atrium joined by
  short covered corridors, and the furniture stands in the same place every
  round.
- Props can taunt with F to score points, and score more with a hunter close
  by. A prop that has been quiet too long is made to honk, for no points.
- Hunters have a sonar on F: every prop nearby honks, decoys stay silent.
  Props hear a hunter's sonar from a distance, and you hear props rustle as
  they move.
- Bot props drop a decoy when they break cover, like a player would.
- The game tells you your role, your goal and the phase in big type. The catch
  is the loudest moment of the round for the shooter, the victim and everyone
  nearby, and the result card tells your round by the role you started with.
- A look sensitivity slider in the lobby options and the match menu.
- Graphics quality: Auto, Low, Medium and High. Auto picks from your graphics
  card and steps down if a round runs slowly. Higher tiers add ambient
  shading, colour grading and a vignette.
- A Copy diagnostics link in the match menus gathers frame rate and graphics
  details to paste into a bug report. Nothing is uploaded.
- An Early alpha badge in the menu header, beside the version.
- A changelog page at /changelog with the notes for every release, linked
  from the menu footer, and a What's new chip in the menu when the game has
  changed since your last visit.
- Privacy and terms pages at /privacy and /terms, and a Reset my stats button
  in the Stats pane that erases your stats and callsign from the server.
- The lobby credits the studio: a Radon Forge link to radonforge.com sits
  under the version stamp in the menu header.

### Changed

- The menu opens on one slice per map. Click a slice, or press the arrow
  keys or its number, and it opens with your avatar inside; Play always plays
  the map you have open. In a party only the host picks the map. Your callsign
  now lives in the avatar picker.
- Quick play joins the busiest room on the map you picked, and opens one there
  if none exists. Your map choice is no longer a hint.
- North District is the first map you see.
- Public rounds follow each other without a trip back to the lobby, and every
  wait is shorter.
- Every round deals each player their own prop spawn, so a room no longer
  starts where the last round ended. Hunters are released at the spawn
  furthest from the props, and hunters who run out of health respawn after a
  short wait instead of sitting out.
- A wrong shot costs less health, and half as much if it only breaks a decoy.
  A capture turns the prop into a hunter and heals the one who caught it.
- Bots play with a player's information. Hunter bots have to spot a prop by
  line of sight and by the tells a player would see: moving, spinning,
  changing shape or honking. Otherwise they test objects one at a time and pay
  for each miss. Bot props hold still while a hunter can see them.
- Props only disguise as objects the map actually contains, and the list of
  North District disguises is wider.
- The menu and avatar picker lose their Close buttons. Clicking away or
  pressing Escape closes them. Glass now covers buttons and map cards too.
- Cars and a work-site fence dress North District. They never count as
  disguises, and a hunter will not mistake them for one.
- The match runs smoother on modest hardware, and the game is capped at 60
  frames per second.
- A shared link previews as the key art instead of a small icon, with a title
  and description around it.

### Fixed

- A walking prop no longer flickers its shadow.
- Night lamps in North District no longer pop in and out as you walk or blow
  out the building fronts, and Kepler-9's lamps no longer glare through the
  ceiling or wash out the lobby stage.
- Roads in North District lay the right way, and the lobby stage's scenery
  stands where it was placed.
- A match that hits an unexpected error shows a rejoin screen instead of a
  blank page.
- A dumpster placed against a wall faces the street, not its side.
- Meteors and loose bones no longer clutter the station.

### Removed

- Ares Outpost. Open ground with long sightlines is the opposite of what a
  prop hunt needs, and two maps split a small player pool less than three.
- The pedestrian figures that were meant to be scenery in North District. They
  never rendered, and a reroll into one left you invisible.

## [0.3.0] - 2026-09-16

You now pick your avatar by clicking the pet on the lobby stage and morphing
through the catalog in place, with the same burst a real disguise change
makes. The menu is rebuilt as glass and appears much faster. You can no longer
be pushed through a wall, and bots stop getting stuck.

### Added

- Choose your avatar by morphing through the catalog on the lobby stage. Click
  the pet and the camera moves in; step with the arrow keys, the mouse wheel or
  the arrows on the rail. Every step plays the materialize burst and morph
  sound the game uses for a real disguise change, and the next avatars load
  ahead of time. Clicking anywhere outside the rail closes the picker, and a
  hint says so.
- Lobby panels are glass, with soft shadows and a lit edge, tinted to suit
  each map so text stays easy to read.

### Changed

- The menu appears much faster, because the 3D backdrop now loads after it
  paints.
- The combat HUD sits on a flat surface instead of glass, so your health is
  easy to read under fire.

### Fixed

- Coming back to a hidden browser tab no longer flings you across the map.
- You can no longer be pushed through a thin prop or wall, even by a long
  frame or another player shoving you.
- Held keys are released when the window loses focus, so you stop walking
  after switching away. Releasing W or the up arrow no longer cancels the
  other while it is still held.
- The weapon on screen matches the one that hits, including after a reconnect
  or returning from the party screen.
- The morph burst plays around you instead of at floor level when you change
  disguise mid-jump or on a crate.
- A taunt no longer leaves the game stuck redrawing shadows for the rest of
  the session.
- A refused mouse capture no longer raises an error.
- The avatar stays on stage when the picker opens, the camera glides rather
  than cuts, and a sideways trackpad swipe works. One swipe steps once and
  does not keep going.
- Bots stop getting stuck. They no longer treat a blocked route as arrival, no
  longer chase a target they have lost sight of by its true position, keep
  running when fleeing, and give up on a hide spot they cannot reach. A
  motionless contact no longer sounds like a noise, and hunters run down a
  disguise they saw fleeing instead of walking after it.
- A room full of bots no longer freezes every other match on the server.

## [0.2.5] - 2026-09-11

A public lobby now says what it is waiting for instead of going quiet until
three bots land at once. iOS stops framing the page in white, and the notice a
phone gets says its piece in one line.

### Added

- A public lobby counts down the wait for bots, so you see
  "Searching for players" with a timer instead of a quiet screen, handing over
  to the start countdown as soon as there is one.

### Fixed

- iOS no longer shows a white band above and below the page.
- The desktop-only notice no longer explains why your phone cannot play.
- The lobby counts only players who are still connected, so it no longer
  claims there are enough to start when the room disagrees.

## [0.2.4] - 2026-09-09

Hunter bots now tell a teammate from a disguise by shape, which ends the pack
that formed in the last release. Morphy also turns away a device it cannot be
played on instead of leading it into a match, and the hunter's health bar is
readable again on a narrow window.

### Added

- Morphy asks to be opened on a PC when it is opened on a phone or a tablet,
  since aiming needs a mouse and movement is on the keyboard. A desktop window
  dragged narrow still plays, and plugging in a mouse lifts the notice.

### Fixed

- Hunter bots no longer follow other hunters around for the whole round. They
  tell a teammate from a disguise by shape, as a player does, but only when
  they can see it: footsteps through a wall tell them nothing. A prop bot
  likewise ignores a disguise it can see and still reacts to an unseen noise.
- The hunter's health bar no longer sits on top of the controls bar on a
  narrow window.

## [0.2.3] - 2026-09-09

Hunter bots no longer deadlock on each other. A round that filled with bots
could stall completely: the hunters gathered in one spot and stayed there,
leaving props unhunted until the timer ran out.

### Fixed

- A hunter bot gives up on a contact it cannot identify. Two hunters used to
  pick each other, meet and stare at each other for the rest of the round,
  growing into a pack with every capture. They now move on, and rounds with
  bots finish again.

## [0.2.2] - 2026-09-09

The lobby now names the build it is running, so a bug report can say exactly
what you were playing.

### Added

- The lobby shows the game's version under the wordmark. A release reads as
  its version, and any build past a release says so with a plus sign.

## [0.2.1] - 2026-09-08

Fairness release: a bot no longer knows anything a player could not, a decoy
no longer gives itself away, and the hunter's weapon points downrange instead
of at its owner.

### Changed

- Bots that fill a room play with a player's information. A bot hunter used to
  read which objects were props straight from the game, so it never had to find
  one. It now relies on line of sight, distance and whether a contact moved
  recently, and wakes up for any contact that comes into view rather than only
  enemies.
- A bot that only hears a contact through a wall is told roughly where it is,
  not the exact spot, so a noise is an area to search rather than a place to
  walk onto.

### Fixed

- The hunter's weapon no longer points backwards at its owner.
- A decoy no longer reveals who placed it, so only its owner knows which
  decoys are theirs.

## [0.2.0] - 2026-09-08

A public match is now playable alone and leavable from every screen: rounds
start on their own, bots fill a quiet room, a lost connection no longer costs
the round, and one match's failure no longer takes the others down with it.

### Added

- A match menu on Escape during a round, with a Leave match button, plus a
  leave button on the results screen and in the public lobby. Before, leaving a
  match meant closing the tab.
- Public rounds start on their own once enough players are in, and Ready now
  shortens the wait, so one idle player can no longer hold a lobby hostage.
- Quiet public rooms fill with bots after a few seconds and hand a bot's seat
  back the moment a human joins, so a lone player still gets a match. Private
  rooms are never filled.
- If your connection drops mid-round, your seat, role and position are held
  for 30 seconds while the game rejoins you, and the scoreboard shows you as
  Reconnecting. Leaving on purpose is still immediate.

### Changed

- The game is now called Morphy, with no domain attached, in the browser tab,
  link previews, the install name and the lobby wordmark.
- Quick play puts everyone in the busiest room instead of splitting players by
  map. Your map choice only decides the map of a room you create.
- If a round is interrupted because too few players remain, the win goes to
  the player left in it.

### Fixed

- A fault inside one match no longer shuts down every other match.
- The match menu no longer paints over the results screen, and chat, weapon
  switching and mute no longer react to keys while it is open.
- Bots no longer take over as host when the last human leaves, and no longer
  speak a line late.

### Removed

- The old morphy.smyile.com address. Links that predate the move now fail
  instead of landing on the game.

## [0.1.1] - 2026-09-07

The game moved to its own domain, and the server's protections caught up with
what 0.1.0 had claimed.

### Changed

- The game moved to morphy.radonforge.com. The old address forwards to the new
  one with your link intact, so existing links keep working.
- Your lifetime stats restart from zero. They are tied to your browser on the
  old address, so they do not follow the move.

### Fixed

- Sounds and models refresh after an update instead of staying cached, as
  0.1.0 promised.

### Security

- Browser protections that were meant to cover every page now do.
- Libraries were updated to clear four known advisories. None was reachable
  from the game.

## [0.1.0] - 2026-07-21

First tracked release: fairer hit detection, a lighter download, and a more
robust match.

### Added

- Automated checks now cover the rules, maps, hit detection, stats and room
  lifecycle.

### Changed

- The game downloads only the models it uses, and menus update as things
  change instead of on a timer.
- Maps with broken or missing data are rejected instead of loading.

### Fixed

- Joining or leaving mid-round no longer corrupts the round, and a player
  disconnecting re-checks who has won.
- Switching weapons mid-cooldown no longer shortens the time before your next
  shot.
- Stats load correctly when the game is served from another address.
- Lobby music retries after a playback failure.
- Your settings are remembered even where the browser blocks storage, and the
  game starts on local networks without a secure connection.
- Sounds and models refresh after an update.

### Security

- Shots now start from where the server knows you are, closing a way to shoot
  through walls.
- Weapon choices are validated more strictly, so invalid ones are rejected.
