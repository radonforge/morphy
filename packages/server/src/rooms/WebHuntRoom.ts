import { type Client, matchMaker, Room, ServerError } from "@colyseus/core";
import { MapSchema, Schema, type } from "@colyseus/schema";
import {
  type AvatarId,
  type BoxCollider,
  computePropBounds,
  DEFAULT_MAP_ID,
  FIRE_COOLDOWN_MS,
  generatePartyCode,
  HIDE_DURATION_MS,
  HUNTER_MAX_HP,
  HUNTER_RATIO,
  type InputMessage,
  isAvatarId,
  isMapId,
  type KillEvent,
  MAX_CHAT_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  type MapDefinition,
  type MapId,
  MIN_PLAYERS_TO_START,
  MSG_CHAT,
  MSG_INPUT,
  MSG_KILL,
  MSG_MAP,
  MSG_READY,
  MSG_SET_MAP,
  MSG_SET_PROFILE,
  MSG_SHOOT,
  MSG_SHOT_RESULT,
  MSG_START,
  MSG_TAUNT,
  MSG_TELEPORT,
  MSG_TRANSFORM,
  PATCH_RATE_MS,
  type Phase,
  type PropBounds,
  ROUND_DURATION_MS,
  ROUND_END_MS,
  type Role,
  randomAvatarId,
  SHOOT_RANGE,
  type ShootMessage,
  START_COUNTDOWN_MS,
  TAUNT_INTERVAL_MS,
  UNTRANSFORMED_PROP_HEIGHT,
  UNTRANSFORMED_PROP_RADIUS,
  type Vec3,
  type Winner,
  WRONG_SHOT_DAMAGE,
} from "@webhunt/shared";
import { buildMap } from "../maps";

const FALLBACK_NAME = "Player";
const SPAWN_CLEARANCE = 1.5;
const PARTY_CODE_MAX_ATTEMPTS = 16;
const PARTY_CODE_EXHAUSTED_STATUS = 503;

export class PlayerState extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") z = 0;
  @type("number") rot = 0;
  @type("number") aim = 0;
  @type("string") role: Role = "prop";
  @type("boolean") alive = true;
  @type("number") hp = 0;
  @type("number") kills = 0;
  @type("string") propType = "";
  @type("boolean") ready = false;
  @type("string") avatar = "";
}

export class RoomState extends Schema {
  @type("string") mapId = "";
  @type("string") phase: Phase = "lobby";
  @type("number") phaseEndsAt = 0;
  @type("string") winner: Winner = "";
  @type("string") hostId = "";
  @type("boolean") isPrivate = false;
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

function parseVec3(value: unknown): { x: number; y: number; z: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!isFiniteNumber(v.x) || !isFiniteNumber(v.y) || !isFiniteNumber(v.z)) return null;
  return { x: v.x, y: v.y, z: v.z };
}

function parseInput(payload: unknown): InputMessage | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (
    !isFiniteNumber(p.x) ||
    !isFiniteNumber(p.y) ||
    !isFiniteNumber(p.z) ||
    !isFiniteNumber(p.rot)
  ) {
    return null;
  }
  return { x: p.x, y: p.y, z: p.z, rot: p.rot, aim: isFiniteNumber(p.aim) ? p.aim : p.rot };
}

function parseShoot(payload: unknown): ShootMessage | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const origin = parseVec3(p.origin);
  const dir = parseVec3(p.dir);
  if (!origin || !dir) return null;
  return { origin, dir };
}

function parsePropType(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const propType = (payload as Record<string, unknown>).propType;
  return typeof propType === "string" ? propType : null;
}

function parseReady(payload: unknown): boolean | null {
  if (typeof payload !== "object" || payload === null) return null;
  const ready = (payload as Record<string, unknown>).ready;
  return typeof ready === "boolean" ? ready : null;
}

function parseChatText(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const text = (payload as Record<string, unknown>).text;
  if (typeof text !== "string") return null;
  const trimmed = text.trim().slice(0, MAX_CHAT_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeName(raw: unknown): string {
  if (typeof raw !== "string") return FALLBACK_NAME;
  const trimmed = raw.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : FALLBACK_NAME;
}

function parseSetMap(payload: unknown): MapId | null {
  if (typeof payload !== "object" || payload === null) return null;
  const map = (payload as Record<string, unknown>).map;
  return isMapId(map) ? map : null;
}

function parseProfile(payload: unknown): { name: string; avatar: AvatarId } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (!isAvatarId(p.avatar)) return null;
  return { name: sanitizeName(p.name), avatar: p.avatar };
}

const UNTRANSFORMED_PROP_BOUNDS: PropBounds = {
  radius: UNTRANSFORMED_PROP_RADIUS,
  yMin: 0,
  yMax: UNTRANSFORMED_PROP_HEIGHT,
};

const SLAB_EPSILON = 1e-6;

type Vec3Tuple = [number, number, number];

/** Distance along the ray to an axis-aligned box (slab method), or null if it misses or lies beyond `maxDist`. */
function rayAabb(
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  min: Vec3Tuple,
  max: Vec3Tuple,
  maxDist: number,
): number | null {
  const o: Vec3Tuple = [origin.x, origin.y, origin.z];
  const d: Vec3Tuple = [dir.x, dir.y, dir.z];
  let tEnter = 0;
  let tExit = maxDist;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(d[axis]!) < SLAB_EPSILON) {
      if (o[axis]! < min[axis]! || o[axis]! > max[axis]!) return null;
      continue;
    }
    let t1 = (min[axis]! - o[axis]!) / d[axis]!;
    let t2 = (max[axis]! - o[axis]!) / d[axis]!;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tEnter) tEnter = t1;
    if (t2 < tExit) tExit = t2;
    if (tEnter > tExit) return null;
  }
  return tEnter;
}

/**
 * Distance along the ray to the prop's hit box: its bounding cylinder squared
 * off in X/Z and spanning [yMin, yMax] in Y, centered at (cx, cz).
 */
function rayHitsBox(
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  cx: number,
  cz: number,
  bounds: PropBounds,
  maxDist: number,
): number | null {
  return rayAabb(
    origin,
    dir,
    [cx - bounds.radius, bounds.yMin, cz - bounds.radius],
    [cx + bounds.radius, bounds.yMax, cz + bounds.radius],
    maxDist,
  );
}

function colliderAabb(c: BoxCollider): { min: Vec3Tuple; max: Vec3Tuple } {
  return {
    min: [c.position.x - c.size.x / 2, c.position.y - c.size.y / 2, c.position.z - c.size.z / 2],
    max: [c.position.x + c.size.x / 2, c.position.y + c.size.y / 2, c.position.z + c.size.z / 2],
  };
}

function nextSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000);
}

export class WebHuntRoom extends Room<{ state: RoomState }> {
  maxClients = MAX_PLAYERS;
  state = new RoomState();
  private map!: MapDefinition;
  private catalogIds = new Set<string>();
  private propBounds = new Map<string, PropBounds>();
  private phaseTimer?: ClearableTimer;
  private tauntTimer?: ClearableTimer;
  private lastShotAt = new Map<string, number>();

  async onCreate(options: unknown): Promise<void> {
    const requested = (options as { map?: unknown } | undefined)?.map;
    const mapId: MapId = isMapId(requested) ? requested : DEFAULT_MAP_ID;
    this.applyMap(buildMap(mapId, nextSeed()));
    this.setPatchRate(PATCH_RATE_MS);
    if ((options as { private?: unknown } | undefined)?.private === true) {
      await this.assignPartyCode();
      await this.setPrivate(true);
      this.state.isPrivate = true;
    }
    this.onMessage(MSG_INPUT, (client, payload) => this.handleInput(client, payload));
    this.onMessage(MSG_TRANSFORM, (client, payload) => this.handleTransform(client, payload));
    this.onMessage(MSG_SHOOT, (client, payload) => this.handleShoot(client, payload));
    this.onMessage(MSG_CHAT, (client, payload) => this.handleChat(client, payload));
    this.onMessage(MSG_READY, (client, payload) => this.handleReady(client, payload));
    this.onMessage(MSG_MAP, (client) => client.send(MSG_MAP, this.map));
    this.onMessage(MSG_START, (client) => this.handleStart(client));
    this.onMessage(MSG_SET_MAP, (client, payload) => this.handleSetMap(client, payload));
    this.onMessage(MSG_SET_PROFILE, (client, payload) => this.handleSetProfile(client, payload));
  }

  private async assignPartyCode(): Promise<void> {
    for (let attempt = 0; attempt < PARTY_CODE_MAX_ATTEMPTS; attempt++) {
      const code = generatePartyCode();
      const taken = await matchMaker.driver.findOne({ roomId: code });
      if (taken) continue;
      this.roomId = code;
      return;
    }
    throw new ServerError(
      PARTY_CODE_EXHAUSTED_STATUS,
      `could not allocate a party code after ${PARTY_CODE_MAX_ATTEMPTS} attempts — try again`,
    );
  }

  private applyMap(map: MapDefinition): void {
    this.map = map;
    this.catalogIds = new Set(map.propCatalog.map((def) => def.id));
    this.propBounds = new Map(map.propCatalog.map((def) => [def.id, computePropBounds(def)]));
    this.state.mapId = map.id;
  }

  private handleChat(client: Client, payload: unknown): void {
    const text = parseChatText(payload);
    if (!text) return;
    const player = this.state.players.get(client.sessionId);
    const name = player?.name ?? "?";
    this.broadcast(MSG_CHAT, { fromId: client.sessionId, name, text });
  }

  onJoin(client: Client, options: unknown): void {
    const name = sanitizeName((options as { name?: unknown } | undefined)?.name);
    const rawAvatar = (options as { avatar?: unknown } | undefined)?.avatar;
    const spawn = this.pickLobbySpawn();
    const player = new PlayerState();
    player.id = client.sessionId;
    player.name = name;
    player.avatar = isAvatarId(rawAvatar) ? rawAvatar : randomAvatarId();
    player.x = spawn.x;
    player.y = spawn.y;
    player.z = spawn.z;
    this.state.players.set(client.sessionId, player);
    if (this.state.hostId === "") this.state.hostId = client.sessionId;
    this.maybeStartRound();
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.lastShotAt.delete(client.sessionId);
    if (this.state.hostId === client.sessionId) {
      this.state.hostId = this.state.players.keys().next().value ?? "";
    }
    if (this.state.players.size < MIN_PLAYERS_TO_START && this.state.phase !== "lobby") {
      this.resetToLobby();
    } else {
      this.maybeStartRound();
    }
  }

  private handleStart(client: Client): void {
    if (!this.state.isPrivate) return;
    if (client.sessionId !== this.state.hostId) return;
    if (this.state.phase !== "lobby") return;
    if (this.state.players.size < MIN_PLAYERS_TO_START) return;
    this.startCountdown();
  }

  private handleSetMap(client: Client, payload: unknown): void {
    if (!this.state.isPrivate) return;
    if (client.sessionId !== this.state.hostId) return;
    if (this.state.phase !== "lobby") return;
    const mapId = parseSetMap(payload);
    if (!mapId || mapId === this.state.mapId) return;
    this.applyMap(buildMap(mapId, nextSeed()));
    this.respawnAllToLobby();
    this.broadcast(MSG_MAP, this.map);
    for (const other of this.clients) {
      const player = this.state.players.get(other.sessionId);
      if (player) other.send(MSG_TELEPORT, { x: player.x, z: player.z });
    }
  }

  private handleSetProfile(client: Client, payload: unknown): void {
    if (this.state.phase !== "lobby") return;
    const profile = parseProfile(payload);
    if (!profile) return;
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.name = profile.name;
    player.avatar = profile.avatar;
  }

  private respawnAllToLobby(): void {
    const spawns = this.map.spawnPoints.props;
    let index = 0;
    this.state.players.forEach((player) => {
      const spawn = spawns[index % spawns.length] ?? this.map.bounds.min;
      index++;
      player.x = spawn.x;
      player.y = spawn.y;
      player.z = spawn.z;
    });
  }

  private handleReady(client: Client, payload: unknown): void {
    if (this.state.phase !== "lobby") return;
    const ready = parseReady(payload);
    if (ready === null) return;
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.ready = ready;
    this.maybeStartRound();
  }

  private pickLobbySpawn(): Vec3 {
    const spawns = this.map.spawnPoints.props;
    for (const candidate of spawns) {
      let occupied = false;
      this.state.players.forEach((p) => {
        if (Math.hypot(p.x - candidate.x, p.z - candidate.z) < SPAWN_CLEARANCE) occupied = true;
      });
      if (!occupied) return candidate;
    }
    return spawns[this.state.players.size % spawns.length] ?? this.map.bounds.min;
  }

  private handleInput(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.alive) return;
    if (player.role === "hunter" && this.state.phase === "hiding") return;
    const input = parseInput(payload);
    if (!input) return;
    const { min, max } = this.map.bounds;
    player.x = clamp(input.x, min.x, max.x);
    player.y = clamp(input.y, min.y, max.y);
    player.z = clamp(input.z, min.z, max.z);
    player.rot = input.rot;
    player.aim = input.aim;
  }

  private handleTransform(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.role !== "prop" || !player.alive) return;
    if (this.state.phase !== "hiding" && this.state.phase !== "hunting") return;
    const propType = parsePropType(payload);
    if (!propType || !this.catalogIds.has(propType)) return;
    player.propType = propType;
  }

  private handleShoot(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.role !== "hunter" || !player.alive) return;
    if (this.state.phase !== "hunting") return;

    const now = Date.now();
    if (now - (this.lastShotAt.get(client.sessionId) ?? 0) < FIRE_COOLDOWN_MS) return;
    this.lastShotAt.set(client.sessionId, now);

    const ray = parseShoot(payload);
    if (!ray) return;
    const len = Math.hypot(ray.dir.x, ray.dir.y, ray.dir.z);
    if (len === 0) return;
    const dir = { x: ray.dir.x / len, y: ray.dir.y / len, z: ray.dir.z / len };

    let wallDist = SHOOT_RANGE;
    for (const collider of this.map.colliders) {
      if (collider.position.y <= 0) continue;
      const { min, max } = colliderAabb(collider);
      const t = rayAabb(ray.origin, dir, min, max, SHOOT_RANGE);
      if (t !== null && t < wallDist) wallDist = t;
    }

    let bestT = Infinity;
    let target: PlayerState | undefined;
    this.state.players.forEach((candidate) => {
      if (candidate === player || candidate.role !== "prop" || !candidate.alive) return;
      const bounds =
        (candidate.propType ? this.propBounds.get(candidate.propType) : undefined) ??
        UNTRANSFORMED_PROP_BOUNDS;
      const t = rayHitsBox(ray.origin, dir, candidate.x, candidate.z, bounds, SHOOT_RANGE);
      if (t !== null && t < wallDist && t < bestT) {
        bestT = t;
        target = candidate;
      }
    });

    if (target) {
      target.role = "hunter";
      target.alive = true;
      target.hp = HUNTER_MAX_HP;
      target.propType = "";
      player.kills += 1;
      this.broadcast(MSG_KILL, {
        byId: player.id,
        byName: player.name,
        victimId: target.id,
        victimName: target.name,
        reason: "converted",
      } satisfies KillEvent);
    } else {
      player.hp = Math.max(0, player.hp - WRONG_SHOT_DAMAGE);
      if (player.hp === 0) {
        player.alive = false;
        this.broadcast(MSG_KILL, {
          byId: "",
          byName: "",
          victimId: player.id,
          victimName: player.name,
          reason: "self",
        } satisfies KillEvent);
      }
    }
    client.send(MSG_SHOT_RESULT, { hit: target !== undefined });
    this.checkRoundEnd();
  }

  private maybeStartRound(): void {
    if (this.state.isPrivate) return;
    if (this.state.phase !== "lobby") return;
    if (this.state.players.size < MIN_PLAYERS_TO_START) return;
    let allReady = true;
    this.state.players.forEach((player) => {
      if (!player.ready) allReady = false;
    });
    if (allReady) this.startCountdown();
  }

  private setPhase(phase: Phase, durationMs: number, next: () => void): void {
    this.state.phase = phase;
    this.state.phaseEndsAt = Date.now() + durationMs;
    this.phaseTimer?.clear();
    this.phaseTimer = this.clock.setTimeout(next, durationMs);
  }

  private startCountdown(): void {
    this.state.winner = "";
    this.setPhase("starting", START_COUNTDOWN_MS, () => this.beginHiding());
  }

  private beginHiding(): void {
    this.assignRoles();
    this.setPhase("hiding", HIDE_DURATION_MS, () => this.beginHunting());
  }

  private beginHunting(): void {
    this.tauntTimer?.clear();
    this.tauntTimer = this.clock.setInterval(() => this.broadcastTaunts(), TAUNT_INTERVAL_MS);
    this.setPhase("hunting", ROUND_DURATION_MS, () => {
      this.state.winner = "props";
      this.endRound();
    });
  }

  private broadcastTaunts(): void {
    this.state.players.forEach((player) => {
      if (player.role === "prop" && player.alive) {
        this.broadcast(MSG_TAUNT, { playerId: player.id, x: player.x, z: player.z });
      }
    });
  }

  private endRound(): void {
    this.tauntTimer?.clear();
    this.tauntTimer = undefined;
    this.setPhase("round_end", ROUND_END_MS, () => this.afterRound());
  }

  private afterRound(): void {
    this.resetToLobby();
  }

  private resetToLobby(): void {
    this.phaseTimer?.clear();
    this.phaseTimer = undefined;
    this.tauntTimer?.clear();
    this.tauntTimer = undefined;
    this.state.phase = "lobby";
    this.state.phaseEndsAt = 0;
    this.state.winner = "";
    this.state.players.forEach((player) => {
      player.ready = false;
      player.role = "prop";
      player.alive = true;
      player.hp = 0;
      player.propType = "";
    });
  }

  private checkRoundEnd(): void {
    if (this.state.phase !== "hunting") return;
    let aliveProps = 0;
    let aliveHunters = 0;
    this.state.players.forEach((player) => {
      if (!player.alive) return;
      if (player.role === "prop") aliveProps++;
      else aliveHunters++;
    });
    if (aliveProps === 0) {
      this.state.winner = "hunters";
      this.endRound();
    } else if (aliveHunters === 0) {
      this.state.winner = "props";
      this.endRound();
    }
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
      player.hp = player.role === "hunter" ? HUNTER_MAX_HP : 0;
      player.kills = 0;
      player.propType = "";
    });
  }
}
