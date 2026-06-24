import { Room, type Client } from "@colyseus/core";
import { Schema, MapSchema, type } from "@colyseus/schema";
import {
  MAX_PLAYERS,
  MAX_NAME_LENGTH,
  MIN_PLAYERS_TO_START,
  HUNTER_RATIO,
  START_COUNTDOWN_MS,
  HIDE_DURATION_MS,
  ROUND_DURATION_MS,
  ROUND_END_MS,
  PATCH_RATE_MS,
  MSG_INPUT,
  MSG_TRANSFORM,
  type InputMessage,
  type MapDefinition,
  type Phase,
  type Role,
} from "@webhunt/shared";
import { loadMap } from "../loadMap";

const DEFAULT_MAP_ID = "office-min";
const FALLBACK_NAME = "Player";

export class PlayerState extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") z = 0;
  @type("number") rot = 0;
  @type("string") role: Role = "prop";
  @type("boolean") alive = true;
  @type("string") propType = "";
}

export class RoomState extends Schema {
  @type("string") mapId = "";
  @type("string") phase: Phase = "lobby";
  @type("number") phaseEndsAt = 0;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}

interface ClearableTimer {
  clear(): void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseInput(payload: unknown): InputMessage | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y) || !isFiniteNumber(p.z) || !isFiniteNumber(p.rot)) {
    return null;
  }
  return { x: p.x, y: p.y, z: p.z, rot: p.rot };
}

function parsePropType(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const propType = (payload as Record<string, unknown>).propType;
  return typeof propType === "string" ? propType : null;
}

function sanitizeName(raw: unknown): string {
  if (typeof raw !== "string") return FALLBACK_NAME;
  const trimmed = raw.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : FALLBACK_NAME;
}

export class WebHuntRoom extends Room<{ state: RoomState }> {
  maxClients = MAX_PLAYERS;
  state = new RoomState();
  private map!: MapDefinition;
  private catalogIds = new Set<string>();
  private phaseTimer?: ClearableTimer;

  onCreate(): void {
    this.map = loadMap(DEFAULT_MAP_ID);
    this.catalogIds = new Set(this.map.propCatalog.map((def) => def.id));
    this.state.mapId = this.map.id;
    this.setPatchRate(PATCH_RATE_MS);
    this.onMessage(MSG_INPUT, (client, payload) => this.handleInput(client, payload));
    this.onMessage(MSG_TRANSFORM, (client, payload) => this.handleTransform(client, payload));
  }

  onJoin(client: Client, options: unknown): void {
    const name = sanitizeName((options as { name?: unknown } | undefined)?.name);
    const spawns = this.map.spawnPoints.props;
    const spawn = spawns[this.state.players.size % spawns.length] ?? this.map.bounds.min;
    const player = new PlayerState();
    player.id = client.sessionId;
    player.name = name;
    player.x = spawn.x;
    player.y = spawn.y;
    player.z = spawn.z;
    this.state.players.set(client.sessionId, player);
    this.maybeStartRound();
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    if (this.state.players.size < MIN_PLAYERS_TO_START && this.state.phase !== "lobby") {
      this.resetToLobby();
    }
  }

  private handleInput(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (player.role === "hunter" && this.state.phase === "hiding") return;
    const input = parseInput(payload);
    if (!input) return;
    const { min, max } = this.map.bounds;
    player.x = clamp(input.x, min.x, max.x);
    player.y = clamp(input.y, min.y, max.y);
    player.z = clamp(input.z, min.z, max.z);
    player.rot = input.rot;
  }

  private handleTransform(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.role !== "prop") return;
    if (this.state.phase !== "hiding" && this.state.phase !== "hunting") return;
    const propType = parsePropType(payload);
    if (!propType || !this.catalogIds.has(propType)) return;
    player.propType = propType;
  }

  private maybeStartRound(): void {
    if (this.state.phase === "lobby" && this.state.players.size >= MIN_PLAYERS_TO_START) {
      this.startCountdown();
    }
  }

  private setPhase(phase: Phase, durationMs: number, next: () => void): void {
    this.state.phase = phase;
    this.state.phaseEndsAt = Date.now() + durationMs;
    this.phaseTimer?.clear();
    this.phaseTimer = this.clock.setTimeout(next, durationMs);
  }

  private startCountdown(): void {
    this.setPhase("starting", START_COUNTDOWN_MS, () => this.beginHiding());
  }

  private beginHiding(): void {
    this.assignRoles();
    this.setPhase("hiding", HIDE_DURATION_MS, () => this.beginHunting());
  }

  private beginHunting(): void {
    this.setPhase("hunting", ROUND_DURATION_MS, () => this.endRound());
  }

  private endRound(): void {
    this.setPhase("round_end", ROUND_END_MS, () => this.afterRound());
  }

  private afterRound(): void {
    if (this.state.players.size >= MIN_PLAYERS_TO_START) {
      this.startCountdown();
    } else {
      this.resetToLobby();
    }
  }

  private resetToLobby(): void {
    this.phaseTimer?.clear();
    this.phaseTimer = undefined;
    this.state.phase = "lobby";
    this.state.phaseEndsAt = 0;
  }

  private assignRoles(): void {
    const players = Array.from(this.state.players.values());
    for (let i = players.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const a = players[i];
      const b = players[j];
      if (a && b) {
        players[i] = b;
        players[j] = a;
      }
    }
    const hunterCount = Math.min(
      Math.max(players.length - 1, 0),
      Math.max(1, Math.round(players.length * HUNTER_RATIO)),
    );
    players.forEach((player, index) => {
      player.role = index < hunterCount ? "hunter" : "prop";
      player.alive = true;
      player.propType = "";
    });
  }
}
