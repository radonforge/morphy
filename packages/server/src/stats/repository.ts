import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DB_PATH } from "../config";

/** Cumulative lifetime stats for one device identity. */
export interface PlayerStatTotals {
  rounds: number;
  wins: number;
  kills: number;
  survivals: number;
}

/** What a single finished round contributed for one player. */
export interface RoundOutcome {
  won: boolean;
  kills: number;
  survived: boolean;
}

/**
 * Persistence boundary for lifetime player stats, keyed by opaque device id.
 * The SQLite implementation is a single local file; swapping to a networked
 * store (e.g. Postgres for a multi-process deploy) is a matter of another
 * implementation of this interface.
 */
export interface PlayerStatsRepository {
  /** Current totals for a device, or zeroes if it has never played. */
  get(deviceId: string): PlayerStatTotals;
  /** Fold one round's outcome into the device's totals and return the new totals. */
  recordRound(deviceId: string, name: string, outcome: RoundOutcome): PlayerStatTotals;
  close(): void;
}

const ZERO_TOTALS: PlayerStatTotals = { rounds: 0, wins: 0, kills: 0, survivals: 0 };

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS player_stats (
    device_id  TEXT PRIMARY KEY,
    name       TEXT    NOT NULL DEFAULT '',
    rounds     INTEGER NOT NULL DEFAULT 0,
    wins       INTEGER NOT NULL DEFAULT 0,
    kills      INTEGER NOT NULL DEFAULT 0,
    survivals  INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;

const SELECT_TOTALS = `
  SELECT rounds, wins, kills, survivals FROM player_stats WHERE device_id = ?;
`;

const UPSERT_ROUND = `
  INSERT INTO player_stats (device_id, name, rounds, wins, kills, survivals, created_at, updated_at)
  VALUES ($deviceId, $name, 1, $wins, $kills, $survivals, $now, $now)
  ON CONFLICT(device_id) DO UPDATE SET
    name       = excluded.name,
    rounds     = rounds + 1,
    wins       = wins + excluded.wins,
    kills      = kills + excluded.kills,
    survivals  = survivals + excluded.survivals,
    updated_at = excluded.updated_at;
`;

function toTotals(row: unknown): PlayerStatTotals {
  if (typeof row !== "object" || row === null) return ZERO_TOTALS;
  const r = row as Record<string, unknown>;
  return {
    rounds: Number(r.rounds ?? 0),
    wins: Number(r.wins ?? 0),
    kills: Number(r.kills ?? 0),
    survivals: Number(r.survivals ?? 0),
  };
}

export class SqlitePlayerStatsRepository implements PlayerStatsRepository {
  private readonly db: DatabaseSync;
  private readonly selectStmt: ReturnType<DatabaseSync["prepare"]>;
  private readonly upsertStmt: ReturnType<DatabaseSync["prepare"]>;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(CREATE_TABLE);
    this.selectStmt = this.db.prepare(SELECT_TOTALS);
    this.upsertStmt = this.db.prepare(UPSERT_ROUND);
  }

  get(deviceId: string): PlayerStatTotals {
    return toTotals(this.selectStmt.get(deviceId));
  }

  recordRound(deviceId: string, name: string, outcome: RoundOutcome): PlayerStatTotals {
    this.upsertStmt.run({
      deviceId,
      name,
      wins: outcome.won ? 1 : 0,
      kills: outcome.kills,
      survivals: outcome.survived ? 1 : 0,
      now: Date.now(),
    });
    return this.get(deviceId);
  }

  close(): void {
    this.db.close();
  }
}

/** Process-wide singleton: one SQLite connection shared by every room. */
export const playerStats: PlayerStatsRepository = new SqlitePlayerStatsRepository(DB_PATH);
