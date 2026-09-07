# Changelog

All notable changes to Morphy are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(0.x releases are pre-1.0).

## [Unreleased]

### Changed

- The name shown to players is now `Morphy`, with no TLD: browser title, Open
  Graph title, PWA install name and the lobby wordmark. The game has never been
  served from `morphy.lol` and there are no plans to buy it, so the brand no
  longer names a domain it does not own. Stored player prefs are untouched — the
  `morphy:` localStorage namespace already carried no TLD.

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
