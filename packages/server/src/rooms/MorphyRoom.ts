import {
  type Client,
  matchMaker,
  Room,
  type RoomException,
  type RoomMethodName,
  ServerError,
} from "@colyseus/core";
import { MapSchema, Schema, type } from "@colyseus/schema";
import { BotDriver, DEFAULT_DIFFICULTY, ScriptedPolicy, snapshot } from "@morphy/bot/brain";
import {
  type AvatarId,
  BOT_FILL_DELAY_MS,
  type BotAct,
  CONVERTED_HUNTER_HP,
  colliderAabb,
  computePropBounds,
  DECOY_BUDGET,
  DECOY_COOLDOWN_MS,
  DECOY_MISS_DAMAGE_FACTOR,
  DEFAULT_MAP_ID,
  DEFAULT_PLAYER_NAME,
  DEFAULT_WEAPON,
  type DecoyBreakEvent,
  generatePartyCode,
  HIDE_DURATION_MS,
  HUNTER_CAPTURE_HEAL,
  HUNTER_MAX_HP,
  HUNTER_RATIO,
  INPUT_SEND_RATE_MS,
  type InputMessage,
  isAvatarId,
  isMapId,
  isWeaponId,
  type KillEvent,
  LOBBY_AUTOSTART_MS,
  MAX_CHAT_LENGTH,
  MAX_CLIENT_MESSAGES_PER_SECOND,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  type MapDefinition,
  type MapId,
  MIN_PLAYERS_TO_START,
  MSG_CHAT,
  MSG_DECOY,
  MSG_DECOY_BREAK,
  MSG_DECOY_PLACED,
  MSG_INPUT,
  MSG_KILL,
  MSG_MAP,
  MSG_PING,
  MSG_PONG,
  MSG_READY,
  MSG_REROLL,
  MSG_SET_MAP,
  MSG_SET_PROFILE,
  MSG_SET_WEAPON,
  MSG_SHOOT,
  MSG_SHOT_FIRED,
  MSG_SHOT_RESULT,
  MSG_START,
  MSG_TAUNT,
  MSG_TAUNT_REQUEST,
  MSG_TELEPORT,
  PATCH_RATE_MS,
  type Phase,
  PING_INTERVAL_MS,
  PING_MAX_MS,
  type PingMessage,
  PLAYER_EYE_HEIGHT,
  type PongMessage,
  type PropBounds,
  RECONNECT_WINDOW_MS,
  REROLL_BUDGET,
  ROUND_DURATION_MS,
  ROUND_END_MS,
  type Role,
  randomAvatarId,
  rayAabb,
  type ShootMessage,
  type ShotFiredEvent,
  type SoundKind,
  START_COUNTDOWN_MS,
  TAUNT_CHECK_MS,
  TAUNT_COOLDOWN_MS,
  TAUNT_DARING_POINTS,
  TAUNT_DARING_RADIUS,
  TAUNT_FORCED_STAGGER_MS,
  TAUNT_INTERVAL_MS,
  TAUNT_POINTS,
  type TauntMessage,
  UNTRANSFORMED_PROP_HEIGHT,
  UNTRANSFORMED_PROP_RADIUS,
  type Vec3,
  WEAPONS,
  type WeaponId,
  type Winner,
} from "@morphy/shared";
import { parseDeviceId } from "../identity";
import { buildMap } from "../maps";
import { playerStats, type RoundOutcome } from "../stats/repository";
import { botName, botSessionId, desiredBotCount, isBotSessionId } from "./botFill";
import { describeRoomException } from "./roomErrors";

const SPAWN_CLEARANCE = 1.5;
const PARTY_CODE_MAX_ATTEMPTS = 16;
const PARTY_CODE_EXHAUSTED_STATUS = 503;
const MS_PER_SECOND = 1_000;

export class PlayerState extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") z = 0;
  @type("float32") rot = 0;
  @type("float32") aim = 0;
  @type("float32") propRot = 0;
  @type("string") role: Role = "prop";
  @type("boolean") alive = true;
  @type("number") hp = 0;
  @type("number") kills = 0;
  /** A prop's points for the round, from taunting. Shown in the standings, never persisted. */
  @type("uint16") score = 0;
  @type("string") propType = "";
  @type("uint8") rerollsLeft = 0;
  @type("uint8") decoysLeft = 0;
  @type("boolean") ready = false;
  @type("string") avatar = "";
  @type("string") weapon: WeaponId = DEFAULT_WEAPON;
  @type("uint16") ping = 0;
  @type("boolean") connected = true;
}

export class DecoyState extends Schema {
  @type("string") id = "";
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") z = 0;
  @type("float32") rot = 0;
  @type("string") propType = "";
  /**
   * Deliberately not a `@type` field: a decoy exists to be mistaken for a real
   * prop, and broadcasting its owner tells every client which props are fake
   * and whose they are. The server needs it to expire a player's decoys, and
   * the owner is told it placed one by `MSG_DECOY_PLACED`, sent to it alone,
   * carrying nothing, because a self-feedback cue is all the client does with
   * it. Nobody else needs any of it.
   */
  owner = "";
}

export class RoomState extends Schema {
  @type("string") mapId = "";
  @type("string") phase: Phase = "lobby";
  @type("number") phaseEndsAt = 0;
  @type("string") winner: Winner = "";
  @type("string") hostId = "";
  @type("number") fillAt = 0;
  @type("boolean") isPrivate = false;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: DecoyState }) decoys = new MapSchema<DecoyState>();
}

interface ClearableTimer {
  clear(): void;
}

/**
 * The part of a Colyseus `Client` the gameplay handlers actually use, so a
 * server-driven bot can stand in for one and go through the very same
 * validation and hit resolution as a human player. `Client` satisfies it.
 */
interface Actor {
  readonly sessionId: string;
  send(type: string, message?: unknown): void;
}

interface BotRuntime {
  driver: BotDriver;
  actor: Actor;
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
  return {
    x: p.x,
    y: p.y,
    z: p.z,
    rot: p.rot,
    aim: isFiniteNumber(p.aim) ? p.aim : p.rot,
    propRot: isFiniteNumber(p.propRot) ? p.propRot : 0,
  };
}

function parseShoot(payload: unknown): ShootMessage | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const dir = parseVec3(p.dir);
  if (!dir) return null;
  return { dir };
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
  if (typeof raw !== "string") return DEFAULT_PLAYER_NAME;
  const trimmed = raw.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : DEFAULT_PLAYER_NAME;
}

function parseSetMap(payload: unknown): MapId | null {
  if (typeof payload !== "object" || payload === null) return null;
  const map = (payload as Record<string, unknown>).map;
  return isMapId(map) ? map : null;
}

function parseWeapon(payload: unknown): WeaponId | null {
  if (typeof payload !== "object" || payload === null) return null;
  const weapon = (payload as Record<string, unknown>).weapon;
  return isWeaponId(weapon) ? weapon : null;
}

function parsePong(payload: unknown): PongMessage | null {
  if (typeof payload !== "object" || payload === null) return null;
  const n = (payload as Record<string, unknown>).n;
  return isFiniteNumber(n) ? { n } : null;
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

/**
 * Distance along the ray to the prop's hit box: its bounding cylinder squared
 * off in X/Z and spanning [yMin, yMax] in Y, centered at (cx, cz) and lifted
 * by the player's current height `cy` so airborne props stay hittable.
 */
function rayHitsBox(
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  cx: number,
  cy: number,
  cz: number,
  bounds: PropBounds,
  maxDist: number,
): number | null {
  return rayAabb(
    origin,
    dir,
    { x: cx - bounds.radius, y: cy + bounds.yMin, z: cz - bounds.radius },
    { x: cx + bounds.radius, y: cy + bounds.yMax, z: cz + bounds.radius },
    maxDist,
  );
}

/** Random direction within a cone of half-angle `spreadRad` around unit vector `dir`. */
function jitterDir(dir: Vec3, spreadRad: number): Vec3 {
  if (spreadRad <= 0) return dir;
  const pivot = Math.abs(dir.y) > 0.99 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const ux = dir.y * pivot.z - dir.z * pivot.y;
  const uy = dir.z * pivot.x - dir.x * pivot.z;
  const uz = dir.x * pivot.y - dir.y * pivot.x;
  const uLen = Math.hypot(ux, uy, uz);
  const vx = uy * dir.z - uz * dir.y;
  const vy = uz * dir.x - ux * dir.z;
  const vz = ux * dir.y - uy * dir.x;
  const spread = Math.tan(spreadRad * Math.sqrt(Math.random()));
  const phi = Math.random() * Math.PI * 2;
  const ox = ((ux * Math.cos(phi) + vx * Math.sin(phi)) / uLen) * spread;
  const oy = ((uy * Math.cos(phi) + vy * Math.sin(phi)) / uLen) * spread;
  const oz = ((uz * Math.cos(phi) + vz * Math.sin(phi)) / uLen) * spread;
  const len = Math.hypot(dir.x + ox, dir.y + oy, dir.z + oz);
  return { x: (dir.x + ox) / len, y: (dir.y + oy) / len, z: (dir.z + oz) / len };
}

function nextSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000);
}

export class MorphyRoom extends Room<{ state: RoomState }> {
  maxClients = MAX_PLAYERS;
  maxMessagesPerSecond = MAX_CLIENT_MESSAGES_PER_SECOND;
  state = new RoomState();
  private map!: MapDefinition;
  private propBounds = new Map<string, PropBounds>();
  private phaseTimer?: ClearableTimer;
  private tauntTimer?: ClearableTimer;
  private nextShotAt = new Map<string, number>();
  private nextDecoyAt = new Map<string, number>();
  private nextTauntAt = new Map<string, number>();
  /** When each prop's forced-taunt clock last restarted; see {@link sweepForcedTaunts}. */
  private tauntClockAt = new Map<string, number>();
  private decoySeq = 0;
  private pendingPings = new Map<string, { nonce: number; sentAt: number }>();
  private pingNonce = 0;
  private deviceIds = new Map<string, string>();
  private roundRoster = new Set<string>();
  private bots = new Map<string, BotRuntime>();
  private botSeq = 0;
  private botTicker?: ClearableTimer;
  private botFillTimer?: ClearableTimer;

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
    this.onMessage(MSG_REROLL, (client) => this.handleReroll(client));
    this.onMessage(MSG_DECOY, (client) => this.handleDecoy(client));
    this.onMessage(MSG_TAUNT_REQUEST, (client) => this.handleTaunt(client));
    this.onMessage(MSG_SHOOT, (client, payload) => this.handleShoot(client, payload));
    this.onMessage(MSG_CHAT, (client, payload) => this.handleChat(client, payload));
    this.onMessage(MSG_READY, (client, payload) => this.handleReady(client, payload));
    this.onMessage(MSG_MAP, (client) => client.send(MSG_MAP, this.map));
    this.onMessage(MSG_START, (client) => this.handleStart(client));
    this.onMessage(MSG_SET_MAP, (client, payload) => this.handleSetMap(client, payload));
    this.onMessage(MSG_SET_PROFILE, (client, payload) => this.handleSetProfile(client, payload));
    this.onMessage(MSG_SET_WEAPON, (client, payload) => this.handleSetWeapon(client, payload));
    this.onMessage(MSG_PONG, (client, payload) => this.handlePong(client, payload));
    this.clock.setInterval(() => this.sendPings(), PING_INTERVAL_MS);
  }

  private sendPings(): void {
    for (const client of this.clients) {
      const nonce = ++this.pingNonce;
      this.pendingPings.set(client.sessionId, { nonce, sentAt: Date.now() });
      client.send(MSG_PING, { n: nonce } satisfies PingMessage);
    }
  }

  private handlePong(client: Client, payload: unknown): void {
    const pong = parsePong(payload);
    if (!pong) return;
    const pending = this.pendingPings.get(client.sessionId);
    if (!pending || pending.nonce !== pong.n) return;
    this.pendingPings.delete(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.ping = clamp(Math.round(Date.now() - pending.sentAt), 0, PING_MAX_MS);
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
      `could not allocate a party code after ${PARTY_CODE_MAX_ATTEMPTS} attempts; try again`,
    );
  }

  private applyMap(map: MapDefinition): void {
    this.map = map;
    this.propBounds = new Map(map.propCatalog.map((def) => [def.id, computePropBounds(def)]));
    this.state.mapId = map.id;
  }

  private handleChat(client: Actor, payload: unknown): void {
    const text = parseChatText(payload);
    if (!text) return;
    const player = this.state.players.get(client.sessionId);
    const name = player?.name ?? "?";
    this.broadcast(MSG_CHAT, { fromId: client.sessionId, name, text });
  }

  onJoin(client: Client, options: unknown): void {
    if (this.state.phase !== "lobby") {
      throw new ServerError(409, "round already in progress");
    }
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
    const deviceId = parseDeviceId((options as { deviceId?: unknown } | undefined)?.deviceId);
    if (deviceId) this.deviceIds.set(client.sessionId, deviceId);
    this.state.players.set(client.sessionId, player);
    if (this.state.hostId === "") this.state.hostId = client.sessionId;
    this.syncBots();
    this.maybeStartRound();
  }

  onLeave(client: Client): void {
    this.removeDecoysOf(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.nextShotAt.delete(client.sessionId);
    this.nextDecoyAt.delete(client.sessionId);
    this.forgetTauntsOf(client.sessionId);
    this.pendingPings.delete(client.sessionId);
    this.deviceIds.delete(client.sessionId);
    if (this.state.hostId === client.sessionId) {
      this.state.hostId = this.firstHumanId();
    }
    if (this.state.phase !== "lobby" && !this.canContinueRound()) {
      this.awardAbortedRound();
      this.resetToLobby();
    } else {
      this.checkRoundEnd();
      this.syncBots();
      this.maybeStartRound();
    }
  }

  /**
   * A dropped connection is not a departure. Hold the seat for
   * {@link RECONNECT_WINDOW_MS} so a network blip does not cost a player the
   * round it is standing in: the player stays in `state.players`, keeps its
   * role and position, and rejoins on the same session id without passing
   * through {@link onJoin}, so neither the in-progress guard there nor the
   * lock a running round takes can shut it out. Colyseus runs {@link onLeave}
   * itself once the window lapses, releasing the seat exactly as a deliberate
   * quit would. A lobby gets no window: there is nothing to come back to, and
   * the seat is better handed straight back.
   */
  onDrop(client: Client): void {
    if (this.state.phase === "lobby") return;
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.connected = false;
    void this.allowReconnection(client, RECONNECT_WINDOW_MS / MS_PER_SECOND).catch(
      (reason: unknown) => {
        if (reason instanceof Error) {
          console.error(`[morphy] could not hold a seat in ${this.roomId}:`, reason.message);
        }
      },
    );
  }

  onReconnect(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = true;
  }

  private handleStart(client: Client): void {
    if (!this.state.isPrivate) return;
    if (client.sessionId !== this.state.hostId) return;
    if (this.state.phase !== "lobby") return;
    if (this.presentCount() < MIN_PLAYERS_TO_START) return;
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

  private handleReady(client: Actor, payload: unknown): void {
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

  private handleInput(client: Actor, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player?.alive) return;
    if (player.role === "hunter" && this.state.phase === "hiding") return;
    const input = parseInput(payload);
    if (!input) return;
    const { min, max } = this.map.bounds;
    player.x = clamp(input.x, min.x, max.x);
    player.y = clamp(input.y, min.y, max.y);
    player.z = clamp(input.z, min.z, max.z);
    player.rot = input.rot;
    player.aim = input.aim;
    player.propRot = Math.atan2(Math.sin(input.propRot), Math.cos(input.propRot));
  }

  private handleReroll(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player?.role !== "prop" || !player.alive) return;
    if (this.state.phase !== "hiding" && this.state.phase !== "hunting") return;
    if (player.rerollsLeft <= 0) return;
    const next = this.randomPropId(player.propType);
    if (!next || next === player.propType) return;
    player.propType = next;
    player.rerollsLeft -= 1;
  }

  private randomPropId(exclude?: string): string {
    const catalog = this.map.propCatalog;
    if (catalog.length === 0) return "";
    const pool =
      exclude && catalog.length > 1 ? catalog.filter((def) => def.id !== exclude) : catalog;
    return pool[Math.floor(Math.random() * pool.length)]?.id ?? "";
  }

  private handleDecoy(client: Actor): void {
    const player = this.state.players.get(client.sessionId);
    if (player?.role !== "prop" || !player.alive || !player.propType) return;
    if (this.state.phase !== "hiding" && this.state.phase !== "hunting") return;
    if (player.decoysLeft <= 0) return;
    const now = Date.now();
    if (now < (this.nextDecoyAt.get(client.sessionId) ?? 0)) return;
    const decoy = new DecoyState();
    decoy.id = `d${this.decoySeq++}`;
    decoy.x = player.x;
    decoy.y = player.y;
    decoy.z = player.z;
    decoy.rot = player.propRot;
    decoy.propType = player.propType;
    decoy.owner = player.id;
    this.state.decoys.set(decoy.id, decoy);
    player.decoysLeft -= 1;
    this.nextDecoyAt.set(client.sessionId, now + DECOY_COOLDOWN_MS);
    client.send(MSG_DECOY_PLACED);
  }

  /**
   * A prop honks on purpose. It scores {@link TAUNT_POINTS}, or
   * {@link TAUNT_DARING_POINTS} with a live hunter within
   * {@link TAUNT_DARING_RADIUS}, and restarts its forced-taunt clock, so a prop
   * that taunts on its own terms is never made to.
   */
  private handleTaunt(client: Actor): void {
    const player = this.state.players.get(client.sessionId);
    if (player?.role !== "prop" || !player.alive) return;
    if (this.state.phase !== "hunting") return;
    const now = Date.now();
    if (now < (this.nextTauntAt.get(client.sessionId) ?? 0)) return;
    this.nextTauntAt.set(client.sessionId, now + TAUNT_COOLDOWN_MS);
    this.tauntClockAt.set(client.sessionId, now);
    player.score += this.hunterWithin(player, TAUNT_DARING_RADIUS)
      ? TAUNT_DARING_POINTS
      : TAUNT_POINTS;
    this.emitTaunt(player, false);
  }

  private hunterWithin(player: PlayerState, radius: number): boolean {
    let near = false;
    this.state.players.forEach((other) => {
      if (other.role !== "hunter" || !other.alive) return;
      if (Math.hypot(other.x - player.x, other.z - player.z) <= radius) near = true;
    });
    return near;
  }

  private emitTaunt(player: PlayerState, forced: boolean): void {
    this.broadcast(MSG_TAUNT, {
      playerId: player.id,
      x: player.x,
      z: player.z,
      forced,
    } satisfies TauntMessage);
    this.letBotsHear("taunt", player.x, player.z, player.id);
  }

  /**
   * Hand a broadcast sound to every room-filling bot but its source, as the
   * position a player's client plays it from. Bots are not clients, so a
   * broadcast alone never reaches them.
   */
  private letBotsHear(kind: SoundKind, x: number, z: number, sourceId: string): void {
    const now = Date.now();
    for (const [sessionId, bot] of this.bots) {
      if (sessionId !== sourceId) bot.driver.hear({ kind, x, z }, now);
    }
  }

  private forgetTauntsOf(sessionId: string): void {
    this.nextTauntAt.delete(sessionId);
    this.tauntClockAt.delete(sessionId);
  }

  private removeDecoysOf(ownerId: string): void {
    const ids: string[] = [];
    this.state.decoys.forEach((decoy, id) => {
      if (decoy.owner === ownerId) ids.push(id);
    });
    for (const id of ids) this.state.decoys.delete(id);
  }

  private breakDecoy(decoy: DecoyState): void {
    this.state.decoys.delete(decoy.id);
    this.broadcast(MSG_DECOY_BREAK, {
      x: decoy.x,
      y: decoy.y,
      z: decoy.z,
      propType: decoy.propType,
    } satisfies DecoyBreakEvent);
  }

  /** A captured prop's cover is blown: its decoys shatter with FX instead of vanishing silently. */
  private breakDecoysOf(ownerId: string): void {
    const doomed: DecoyState[] = [];
    this.state.decoys.forEach((decoy) => {
      if (decoy.owner === ownerId) doomed.push(decoy);
    });
    for (const decoy of doomed) this.breakDecoy(decoy);
  }

  private handleSetWeapon(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player?.alive) return;
    const weapon = parseWeapon(payload);
    if (!weapon || weapon === player.weapon) return;
    player.weapon = weapon;
  }

  private resolvePellet(
    shooter: PlayerState,
    origin: Vec3,
    dir: Vec3,
    range: number,
    captured: Set<PlayerState>,
    broken: Set<DecoyState>,
  ): { end: Vec3; target: PlayerState | undefined; decoy: DecoyState | undefined } {
    let wallDist = range;
    for (const collider of this.map.colliders) {
      if (collider.position.y <= 0) continue;
      const { min, max } = colliderAabb(collider);
      const t = rayAabb(origin, dir, min, max, range);
      if (t !== null && t < wallDist) wallDist = t;
    }

    let bestT = Infinity;
    let target: PlayerState | undefined;
    this.state.players.forEach((candidate) => {
      if (candidate === shooter || candidate.role !== "prop" || !candidate.alive) return;
      if (captured.has(candidate)) return;
      const bounds =
        (candidate.propType ? this.propBounds.get(candidate.propType) : undefined) ??
        UNTRANSFORMED_PROP_BOUNDS;
      const t = rayHitsBox(origin, dir, candidate.x, candidate.y, candidate.z, bounds, range);
      if (t !== null && t < wallDist && t < bestT) {
        bestT = t;
        target = candidate;
      }
    });

    let decoyT = Infinity;
    let decoy: DecoyState | undefined;
    this.state.decoys.forEach((d) => {
      if (broken.has(d)) return;
      const bounds = this.propBounds.get(d.propType) ?? UNTRANSFORMED_PROP_BOUNDS;
      const t = rayHitsBox(origin, dir, d.x, d.y, d.z, bounds, range);
      if (t !== null && t < wallDist && t < decoyT) {
        decoyT = t;
        decoy = d;
      }
    });

    let reach: number;
    if (target !== undefined && bestT <= decoyT) {
      decoy = undefined;
      reach = bestT;
    } else if (decoy !== undefined) {
      target = undefined;
      reach = decoyT;
    } else {
      target = undefined;
      reach = wallDist;
    }
    return {
      end: {
        x: origin.x + dir.x * reach,
        y: origin.y + dir.y * reach,
        z: origin.z + dir.z * reach,
      },
      target,
      decoy,
    };
  }

  private handleShoot(client: Actor, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (player?.role !== "hunter" || !player.alive) return;
    if (this.state.phase !== "hunting") return;

    const weapon = WEAPONS[player.weapon];

    const now = Date.now();
    if (now < (this.nextShotAt.get(client.sessionId) ?? 0)) return;

    const ray = parseShoot(payload);
    if (!ray) return;
    const len = Math.hypot(ray.dir.x, ray.dir.y, ray.dir.z);
    if (len === 0) return;
    const dir = { x: ray.dir.x / len, y: ray.dir.y / len, z: ray.dir.z / len };
    const origin: Vec3 = { x: player.x, y: player.y + PLAYER_EYE_HEIGHT, z: player.z };
    this.nextShotAt.set(client.sessionId, now + weapon.cooldownMs);

    const ends: Vec3[] = [];
    const captured = new Set<PlayerState>();
    const broken = new Set<DecoyState>();
    for (let pellet = 0; pellet < weapon.pellets; pellet++) {
      const pelletDir = jitterDir(dir, weapon.spreadRad);
      const { end, target, decoy } = this.resolvePellet(
        player,
        origin,
        pelletDir,
        weapon.range,
        captured,
        broken,
      );
      ends.push(end);
      if (target) captured.add(target);
      else if (decoy) broken.add(decoy);
    }

    this.broadcast(MSG_SHOT_FIRED, {
      shooterId: player.id,
      weapon: weapon.id,
      origin,
      ends,
    } satisfies ShotFiredEvent);

    for (const d of broken) this.breakDecoy(d);

    if (captured.size > 0) {
      for (const target of captured) {
        target.role = "hunter";
        target.alive = true;
        target.hp = CONVERTED_HUNTER_HP;
        target.propType = "";
        target.decoysLeft = 0;
        this.breakDecoysOf(target.id);
        player.kills += 1;
        player.hp = Math.min(HUNTER_MAX_HP, player.hp + HUNTER_CAPTURE_HEAL);
        this.broadcast(MSG_KILL, {
          byId: player.id,
          byName: player.name,
          victimId: target.id,
          victimName: target.name,
          reason: "converted",
        } satisfies KillEvent);
      }
    } else {
      const damage =
        broken.size > 0
          ? Math.floor(weapon.missDamage * DECOY_MISS_DAMAGE_FACTOR)
          : weapon.missDamage;
      player.hp = Math.max(0, player.hp - damage);
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
    client.send(MSG_SHOT_RESULT, { hit: captured.size > 0 });
    this.checkRoundEnd();
  }

  /**
   * Public rooms start on their own: reaching {@link MIN_PLAYERS_TO_START} arms
   * a {@link LOBBY_AUTOSTART_MS} clock, and `ready` only shortens it rather
   * than authorising the round, so one idle player can no longer hold a lobby
   * hostage. A non-zero `phaseEndsAt` is the armed clock, so a later joiner
   * does not push the start further out. Private rooms are unaffected: their
   * host starts the round with {@link MSG_START}.
   */
  private maybeStartRound(): void {
    if (this.state.isPrivate) return;
    if (this.state.phase !== "lobby") return;
    if (this.presentCount() < MIN_PLAYERS_TO_START) {
      this.cancelAutoStart();
      return;
    }
    let allReady = true;
    this.state.players.forEach((player) => {
      if (!player.ready) allReady = false;
    });
    if (allReady) {
      this.startCountdown();
      return;
    }
    if (this.state.phaseEndsAt === 0) {
      this.setPhase("lobby", LOBBY_AUTOSTART_MS, () => this.startCountdown());
    }
  }

  private cancelAutoStart(): void {
    this.phaseTimer?.clear();
    this.phaseTimer = undefined;
    this.state.phaseEndsAt = 0;
  }

  private setPhase(phase: Phase, durationMs: number, next: () => void): void {
    this.state.phase = phase;
    this.state.phaseEndsAt = Date.now() + durationMs;
    this.phaseTimer?.clear();
    this.phaseTimer = this.clock.setTimeout(next, durationMs);
  }

  private startCountdown(): void {
    this.state.winner = "";
    this.cancelBotFill();
    if (!this.locked) {
      void this.lock().catch((error: unknown) => {
        console.error(`[morphy] failed to lock room ${this.roomId}:`, error);
      });
    }
    this.setPhase("starting", START_COUNTDOWN_MS, () => this.beginHiding());
  }

  private beginHiding(): void {
    this.state.decoys.clear();
    this.nextDecoyAt.clear();
    this.nextTauntAt.clear();
    this.tauntClockAt.clear();
    this.assignRoles();
    this.setPhase("hiding", HIDE_DURATION_MS, () => this.beginHunting());
  }

  private beginHunting(): void {
    this.startTauntClocks();
    this.tauntTimer?.clear();
    this.tauntTimer = this.clock.setInterval(() => this.sweepForcedTaunts(), TAUNT_CHECK_MS);
    this.setPhase("hunting", ROUND_DURATION_MS, () => {
      this.state.winner = "props";
      this.endRound();
    });
    this.checkRoundEnd();
  }

  /**
   * Start every prop's forced-taunt clock at a random point of the first
   * {@link TAUNT_FORCED_STAGGER_MS} of the hunt. A clock starting with the hunt
   * for everyone would make every prop's first forced taunt fire in the same
   * second, which blurs them into one honk with no direction.
   */
  private startTauntClocks(): void {
    const now = Date.now();
    this.state.players.forEach((player, sessionId) => {
      if (player.role !== "prop" || !player.alive) return;
      this.tauntClockAt.set(sessionId, now + Math.random() * TAUNT_FORCED_STAGGER_MS);
    });
  }

  /** Make every prop that has not taunted within {@link TAUNT_INTERVAL_MS} honk, for no points. */
  private sweepForcedTaunts(): void {
    const now = Date.now();
    this.state.players.forEach((player, sessionId) => {
      if (player.role !== "prop" || !player.alive) return;
      const since = this.tauntClockAt.get(sessionId);
      if (since === undefined) {
        this.tauntClockAt.set(sessionId, now);
        return;
      }
      if (now - since < TAUNT_INTERVAL_MS) return;
      this.tauntClockAt.set(sessionId, now);
      this.emitTaunt(player, true);
    });
  }

  private endRound(): void {
    this.tauntTimer?.clear();
    this.tauntTimer = undefined;
    this.recordRoundStats();
    this.setPhase("round_end", ROUND_END_MS, () => this.afterRound());
  }

  /**
   * Persist the just-finished round into the lifetime stats of every player who
   * was present when roles were assigned. Only the start-of-round roster counts,
   * so a mid-round joiner cannot claim a round. Runs once per genuinely completed
   * round; rounds aborted to the lobby (too few players) never reach here. Stat
   * writes are best-effort: a DB failure is logged and skips that player rather
   * than breaking round progression.
   */
  private recordRoundStats(): void {
    const winner = this.state.winner;
    this.state.players.forEach((player, sessionId) => {
      if (!this.roundRoster.has(sessionId)) return;
      const deviceId = this.deviceIds.get(sessionId);
      if (!deviceId) return;
      const outcome: RoundOutcome = {
        won:
          (winner === "hunters" && player.role === "hunter") ||
          (winner === "props" && player.role === "prop"),
        kills: player.kills,
        survived: player.role === "prop" && player.alive,
      };
      try {
        playerStats.recordRound(deviceId, player.name, outcome);
      } catch (error) {
        console.error(`[morphy] stats record failed for ${sessionId}:`, error);
      }
    });
  }

  private afterRound(): void {
    this.resetToLobby();
  }

  /**
   * A round is worth continuing while a human is still in it and enough players
   * remain to hold both roles. Bots satisfy the second condition but never the
   * first: the bot fill target exceeds {@link MIN_PLAYERS_TO_START}, so a
   * headcount that counts bots can never fall below the threshold, and a room
   * whose last human walked out would keep an unattended match ticking for the
   * rest of {@link ROUND_DURATION_MS}.
   */
  private canContinueRound(): boolean {
    return this.humanCount() > 0 && this.state.players.size >= MIN_PLAYERS_TO_START;
  }

  /**
   * A round that runs out of players used to end without touching anyone's
   * record, so one player quitting erased the round for whoever was left too.
   * The human left holding the room now takes the win instead. Only a round
   * with roles already assigned counts: an abort during the start countdown has
   * no roster for this round yet, and a round in `round_end` was recorded by
   * `endRound`. A round abandoned by its last human awards nobody: there is no
   * survivor to reward, and a bot's record is not kept. A held seat is not a
   * survivor either: someone still inside their reconnect window has not
   * outlasted the round, they are simply absent from its end.
   */
  private awardAbortedRound(): void {
    if (this.state.phase !== "hiding" && this.state.phase !== "hunting") return;
    const survivor = this.state.players.get(this.firstPresentHumanId());
    if (!survivor) return;
    this.state.winner = survivor.role === "hunter" ? "hunters" : "props";
    this.recordRoundStats();
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
      player.propRot = 0;
      player.rerollsLeft = 0;
      player.decoysLeft = 0;
    });
    this.state.decoys.clear();
    this.nextDecoyAt.clear();
    this.nextTauntAt.clear();
    this.tauntClockAt.clear();
    if (this.locked) {
      void this.unlock().catch((error: unknown) => {
        console.error(`[morphy] failed to unlock room ${this.roomId}:`, error);
      });
    }
    this.syncBots();
    this.maybeStartRound();
  }

  /**
   * Colyseus guards a room's clock callbacks and message handlers only when
   * this hook exists, and `index.ts` asks for no graceful shutdown, so there is
   * no process-level net underneath either. Without it a throw takes down the
   * whole server process and every other room on it. Measured both ways: for
   * a phase timer, for the {@link PING_INTERVAL_MS} ping interval, and for a
   * message handler reached by a bad payload. Lifecycle methods (`onJoin`,
   * `onLeave`, …) still rethrow afterwards, so Colyseus's own handling of them
   * is unchanged. Do not remove it.
   */
  onUncaughtException(error: RoomException, methodName: RoomMethodName): void {
    const cause = error.cause;
    console.error(
      `[morphy] ${describeRoomException(error, methodName, this.roomId)}`,
      cause instanceof Error ? cause.stack : cause,
    );
  }

  onDispose(): void {
    this.stopBotTicker();
    this.cancelBotFill();
    for (const bot of this.bots.values()) this.stopDriver(bot);
    this.bots.clear();
  }

  /** A bot must never inherit the host seat: it would never press start. */
  private firstHumanId(): string {
    for (const sessionId of this.state.players.keys()) {
      if (!isBotSessionId(sessionId)) return sessionId;
    }
    return "";
  }

  /** The human a round can be credited to: present in the room and still on it. */
  private firstPresentHumanId(): string {
    for (const sessionId of this.state.players.keys()) {
      if (isBotSessionId(sessionId)) continue;
      if (this.state.players.get(sessionId)?.connected) return sessionId;
    }
    return "";
  }

  /**
   * Players a round can actually be built from. Bots count, since they exist to make
   * the threshold reachable, but a player inside their reconnect window does
   * not: their seat is held, they are not there to play.
   */
  private presentCount(): number {
    let present = 0;
    this.state.players.forEach((player) => {
      if (player.connected) present++;
    });
    return present;
  }

  private humanCount(): number {
    let humans = 0;
    this.state.players.forEach((_player, sessionId) => {
      if (!isBotSessionId(sessionId)) humans++;
    });
    return humans;
  }

  /**
   * Bring the bot population in line with {@link desiredBotCount}. Removals are
   * immediate so an arriving human takes a bot's seat at once; additions wait
   * out {@link BOT_FILL_DELAY_MS}, giving real players a chance to show up
   * first. Only ever runs in a public lobby, so a round's roster never changes
   * under the players.
   *
   * `state.fillAt` publishes when that wait ends, so a player alone in a room
   * sees the wait counted down instead of three bots appearing unannounced. It
   * is the only window in which the lobby has no other countdown to show:
   * {@link maybeStartRound} leaves `phaseEndsAt` at 0 below
   * {@link MIN_PLAYERS_TO_START}.
   */
  private syncBots(): void {
    if (this.state.isPrivate || this.state.phase !== "lobby") return;
    const want = desiredBotCount(this.humanCount());
    for (const sessionId of [...this.bots.keys()]) {
      if (this.bots.size <= want) break;
      this.removeBot(sessionId);
    }
    if (this.bots.size >= want) {
      this.cancelBotFill();
      return;
    }
    if (!this.botFillTimer) {
      this.state.fillAt = Date.now() + BOT_FILL_DELAY_MS;
      this.botFillTimer = this.clock.setTimeout(() => {
        this.botFillTimer = undefined;
        this.state.fillAt = 0;
        this.fillBots();
      }, BOT_FILL_DELAY_MS);
    }
  }

  private cancelBotFill(): void {
    this.botFillTimer?.clear();
    this.botFillTimer = undefined;
    this.state.fillAt = 0;
  }

  /**
   * Seat bots up to {@link desiredBotCount}, stopping at the first one that
   * cannot be seated. Every bot in a room takes the same `this.map`, so a map
   * one driver rejects no driver will accept: without the stop, a failing
   * {@link addBot} never grows `this.bots` and this loop spins forever. It is
   * synchronous, so that would pin the event loop and take down every other
   * room on the process, and no exception handler would see it: nothing
   * throws, the method simply never returns.
   */
  private fillBots(): void {
    if (this.state.isPrivate || this.state.phase !== "lobby") return;
    const want = desiredBotCount(this.humanCount());
    while (this.bots.size < want) {
      if (!this.addBot()) break;
    }
    this.maybeStartRound();
  }

  /**
   * A room-filling bot plays with `"limited"` vision on purpose. The `"full"`
   * mode reads ground truth (`role`, `alive`, `propType`) and exists as the
   * parity anchor for measuring policies, not as a way to play: a hunter given
   * it never has to *find* a prop, it targets the disguise straight through.
   * These bots are here to make a thin room playable for the humans in it, so
   * they get what a player gets: line of sight, distance, and whether a contact
   * has moved recently.
   *
   * Returns whether the bot took its seat, so {@link fillBots} can stop rather
   * than ask again for something that cannot succeed.
   *
   * Bot code runs inside a room `clock` callback, where a throw is contained by
   * {@link onUncaughtException}, but contained means the whole callback dies,
   * so one failing brain would cost every bot behind it in that tick its turn,
   * and go on doing so every tick. A bot is an amenity: if its brain fails,
   * drop that bot and keep the match running.
   */
  private addBot(): boolean {
    const seq = ++this.botSeq;
    const sessionId = botSessionId(seq);
    const spawn = this.pickLobbySpawn();
    const player = new PlayerState();
    player.id = sessionId;
    player.name = botName(seq);
    player.avatar = randomAvatarId();
    player.x = spawn.x;
    player.y = spawn.y;
    player.z = spawn.z;
    this.state.players.set(sessionId, player);

    const driver = new BotDriver({
      name: player.name,
      difficulty: DEFAULT_DIFFICULTY,
      readyAtPlayers: MIN_PLAYERS_TO_START,
      policy: new ScriptedPolicy(DEFAULT_DIFFICULTY),
      visibility: "limited",
      trace: null,
    });
    try {
      driver.setMap(this.map);
      driver.syncPosition(spawn.x, spawn.z);
    } catch (error) {
      console.error(`[morphy] bot ${sessionId} failed to take the map, skipping it:`, error);
      this.state.players.delete(sessionId);
      return false;
    }
    this.bots.set(sessionId, { driver, actor: { sessionId, send: () => undefined } });
    if (!this.botTicker) {
      this.botTicker = this.clock.setInterval(() => this.tickBots(), INPUT_SEND_RATE_MS);
    }
    return true;
  }

  private removeBot(sessionId: string): void {
    const bot = this.bots.get(sessionId);
    if (!bot) return;
    this.bots.delete(sessionId);
    this.stopDriver(bot);
    this.removeDecoysOf(sessionId);
    this.state.players.delete(sessionId);
    this.nextShotAt.delete(sessionId);
    this.nextDecoyAt.delete(sessionId);
    this.forgetTauntsOf(sessionId);
    if (this.bots.size === 0) this.stopBotTicker();
  }

  private stopDriver(bot: BotRuntime): void {
    void bot.driver.stop().catch((error: unknown) => {
      console.error(`[morphy] bot ${bot.actor.sessionId} failed to stop:`, error);
    });
  }

  private stopBotTicker(): void {
    this.botTicker?.clear();
    this.botTicker = undefined;
  }

  /**
   * Drive every bot one tick. Their motor output goes through the same
   * `handle*` entry points a real client's messages do, so bots get no
   * authority a player does not have.
   */
  private tickBots(): void {
    const now = Date.now();
    for (const sessionId of [...this.bots.keys()]) {
      const bot = this.bots.get(sessionId);
      if (!bot) continue;
      try {
        this.driveBot(bot, sessionId, now);
      } catch (error) {
        console.error(`[morphy] bot ${sessionId} brain failed, dropping it:`, error);
        this.removeBot(sessionId);
      }
    }
  }

  private driveBot(bot: BotRuntime, sessionId: string, now: number): void {
    const action = bot.driver.tick(snapshot(this.state, sessionId), now);
    if (action.ready) this.handleReady(bot.actor, { ready: true });
    if (action.act) this.handleAct(bot.actor, action.act);
    if (action.input) this.handleInput(bot.actor, action.input);
    if (action.shoot) this.handleShoot(bot.actor, { dir: action.shoot.dir });
    if (action.say) this.handleChat(bot.actor, { text: action.say });
  }

  /**
   * A bot's key press, routed to the handler the matching client message
   * reaches, so it passes the same checks. It runs before the tick's movement,
   * which puts a decoy where the bot stood when it decided to drop one.
   */
  private handleAct(actor: Actor, act: BotAct): void {
    switch (act) {
      case "decoy":
        this.handleDecoy(actor);
        break;
      case "taunt":
        this.handleTaunt(actor);
        break;
    }
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

  /**
   * Deal the round to the players who are there for it. Someone inside their
   * reconnect window is in `state.players` but not in the round: they take no
   * role slot, join no roster, and sit in the same state a dead player already
   * occupies, so nothing counts them as a live prop or a missing hunter. The
   * role they had when they dropped is untouched: this only runs at the start
   * of a round, never during one.
   */
  private assignRoles(): void {
    const players: PlayerState[] = [];
    this.roundRoster = new Set();
    this.state.players.forEach((player, sessionId) => {
      if (player.connected) {
        players.push(player);
        this.roundRoster.add(sessionId);
        return;
      }
      player.role = "prop";
      player.alive = false;
      player.hp = 0;
      player.propType = "";
      player.rerollsLeft = 0;
      player.decoysLeft = 0;
    });
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
      player.score = 0;
      player.propType = player.role === "prop" ? this.randomPropId() : "";
      player.propRot = 0;
      player.rerollsLeft = player.role === "prop" ? REROLL_BUDGET : 0;
      player.decoysLeft = player.role === "prop" ? DECOY_BUDGET : 0;
    });
  }
}
