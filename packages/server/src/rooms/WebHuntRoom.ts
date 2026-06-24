import { Room, type Client } from "@colyseus/core";
import { Schema, MapSchema, type } from "@colyseus/schema";
import {
  MAX_PLAYERS,
  MAX_NAME_LENGTH,
  PATCH_RATE_MS,
  MSG_INPUT,
  type InputMessage,
  type MapDefinition,
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
}

export class RoomState extends Schema {
  @type("string") mapId = "";
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
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

function sanitizeName(raw: unknown): string {
  if (typeof raw !== "string") return FALLBACK_NAME;
  const trimmed = raw.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : FALLBACK_NAME;
}

export class WebHuntRoom extends Room<{ state: RoomState }> {
  maxClients = MAX_PLAYERS;
  state = new RoomState();
  private map!: MapDefinition;

  onCreate(): void {
    this.map = loadMap(DEFAULT_MAP_ID);
    this.state.mapId = this.map.id;
    this.setPatchRate(PATCH_RATE_MS);
    this.onMessage(MSG_INPUT, (client, payload) => this.handleInput(client, payload));
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
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
  }

  private handleInput(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const input = parseInput(payload);
    if (!input) return;
    const { min, max } = this.map.bounds;
    player.x = clamp(input.x, min.x, max.x);
    player.y = clamp(input.y, min.y, max.y);
    player.z = clamp(input.z, min.z, max.z);
    player.rot = input.rot;
  }
}
