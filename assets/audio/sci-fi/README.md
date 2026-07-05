# Staged sci-fi audio

Curated candidates from Kenney's [Sci-fi Sounds](https://kenney.nl/assets/sci-fi-sounds) pack (CC0, see `License.txt`). Nothing here ships with the client — to use a sound, copy it to `packages/client/public/sounds/sci-fi/` and wire it in `game/audio.ts`.

Earmarked uses:

- `forceField_*` — morph/materialize sound alternative (tried `forceField_000` as the lobby deploy sting, rejected: too harsh — deploy is a synth two-tone now)
- `computerNoise_*` — sparse station ambience one-shots (tried as lobby ambience, rejected: too harsh)
- `explosionCrunch_*` — hunter miss/self-damage feedback, conversion sting
- `lowFrequency_explosion_*` — round-end or conversion bass hit
- `impactMetal_002-004` — extra variants for shot impact sparks
