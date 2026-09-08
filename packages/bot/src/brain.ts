/**
 * The transport-free surface of the bot package: everything needed to run a
 * bot's behaviour against a world snapshot, with no Colyseus SDK in the import
 * graph. `packages/bot/src/bot.ts` drives it over the network; the server
 * drives it against its own authoritative room state to fill quiet public
 * rooms, which is why this entry point exists as `@morphy/bot/brain`.
 */
export { BOT_NAMES, clampDifficulty, DEFAULT_DIFFICULTY } from "./config";
export { BotDriver, type BotDriverOptions, type DriverAction } from "./driver";
export { ScriptedPolicy } from "./policy/scripted";
export type { Policy } from "./policy/types";
export { type BotDecoy, type BotPlayer, snapshot, type WorldSnapshot } from "./view";
