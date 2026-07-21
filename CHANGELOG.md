# Changelog

All notable changes to morphy.lol are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(0.x releases are pre-1.0).

## [Unreleased]

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
