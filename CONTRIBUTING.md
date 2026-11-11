# Contributing to Morphy

Thanks for wanting to help. Morphy is a small project run by two people in their spare time, so
a short, focused pull request gets reviewed much sooner than a large one.

## Before you start

- **Bugs:** open an issue with what you did, what you expected and what happened. If it
  happens in a match, press Esc during a round and use Copy diagnostics in the match menu: it
  copies the browser, GPU and build to paste in.
- **Anything bigger than a bug fix** (a feature, a new map, a balance change, a new dependency):
  open an issue first and wait for a reply, so neither of us spends time on something that will
  not be merged.
- Some directions are settled: Morphy has no accounts or login (a browser's device id is all the
  identity there is), it is multiplayer-first (bots only fill thin rooms), and the `R` reroll
  stays random rather than becoming a picker. Proposals against these are likely to be declined.

## Setup

You need Node 24 or later and the pnpm version pinned in `package.json`; `corepack enable` sets
it up for you.

```bash
corepack enable
pnpm install
pnpm dev     # game server on :2567, client on :5173
pnpm bot     # headless bots to play against, see packages/bot/README.md
```

Read `AGENTS.md` before changing anything non-trivial: it explains the package boundaries, the
authority split between client and server, and why things are the way they are.

## Checks

CI runs these four on every pull request. Run them before you push:

```bash
pnpm check:ci
pnpm typecheck
pnpm test
pnpm --filter @morphy/client build
```

Tests use plain `node:test` over the real modules. A new test file has to be registered in the
`test` script of the root `package.json`, or it does not run.

## Pull requests

- One concern per pull request: a fix, a feature or a refactor, never two at once.
- Commit messages and the pull request title follow
  [Conventional Commits](https://www.conventionalcommits.org/): `fix: …`, `feat: …`, `docs: …`.
- Everything in the repository is in English: code, comments, docs and in-game text.
- Gameplay numbers go in `packages/shared/src/constants.ts`, never inline.
- Add or update a test for any behaviour you change. A UI change needs a screenshot or a short
  clip in the pull request.
- Do not add a dependency without agreeing on it in an issue first.

## Assets

Only assets you made yourself, or that are CC0 or under a license compatible with redistribution,
can be added; say where each one comes from in the pull request, and add it to `COPYING.md`.
A model must also be on the allow-list in `packages/client/runtimeAssets.ts` to ship.

## License

By contributing you agree that your contribution is released under the [MIT License](LICENSE),
the same as the rest of the code. Assets you add are covered by the license you state for them in
`COPYING.md`.

## Conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
