import { resolve } from "node:path";

const DEFAULT_DB_DIR = "data";
const DEFAULT_DB_FILE = "morphy-stats.db";

/**
 * Absolute path to the SQLite stats database. Set MORPHY_DB_PATH in production
 * to a location outside the deploy directory so a redeploy or `git pull` never
 * wipes accumulated player stats. Defaults to `./data/morphy-stats.db` under the
 * process working directory for local development.
 */
export const DB_PATH: string =
  process.env.MORPHY_DB_PATH ?? resolve(process.cwd(), DEFAULT_DB_DIR, DEFAULT_DB_FILE);
