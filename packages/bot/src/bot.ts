import { Client, type Room } from "@colyseus/sdk";
import {
  INPUT_SEND_RATE_MS,
  type Intent,
  type MapDefinition,
  type MapId,
  MSG_CHAT,
  MSG_INPUT,
  MSG_KILL,
  MSG_MAP,
  MSG_READY,
  MSG_SHOOT,
  MSG_SHOT_RESULT,
  MSG_TAUNT,
  MSG_TELEPORT,
  MSG_TRANSFORM,
  type Observation,
  type Phase,
  parseMapDefinition,
  ROOM_NAME,
  type Role,
  type Visibility,
} from "@webhunt/shared";
import {
  ARRIVE_EPSILON,
  BOT_VISION_RANGE,
  CONNECT_TIMEOUT_MS,
  DECIDE_INTERVAL_MS,
  DECIDE_TIMEOUT_MS,
  MAX_TICK_SECONDS,
} from "./config";
import type { Policy } from "./policy/types";
import { Reflex, type ReflexWorld } from "./reflex";
import type { Trace } from "./trace";
import { snapshot } from "./view";

const BOOTSTRAP_INTENT: Intent = { kind: "patrol", seq: 0 };

/**
 * Whether two intents differ in what the reflex should *do*, ignoring `seq`. A
 * new decision with the same behaviour (e.g. the same `hideAs` spot re-issued
 * every ~700ms) must NOT reset the reflex's path, or the bot re-plans and
 * micro-steps each cycle — the back-and-forth jitter while "parked".
 */
function behaviorChanged(prev: Intent, next: Intent): boolean {
  if (prev.kind !== next.kind) return true;
  if (prev.kind === "moveTo" && next.kind === "moveTo") {
    return prev.run !== next.run || Math.hypot(prev.x - next.x, prev.z - next.z) > ARRIVE_EPSILON;
  }
  if (prev.kind === "hideAs" && next.kind === "hideAs") {
    return (
      prev.propType !== next.propType ||
      Math.hypot(prev.x - next.x, prev.z - next.z) > ARRIVE_EPSILON
    );
  }
  if (prev.kind === "inspect" && next.kind === "inspect") return prev.targetId !== next.targetId;
  if (prev.kind === "shootTarget" && next.kind === "shootTarget")
    return prev.targetId !== next.targetId;
  if (prev.kind === "transform" && next.kind === "transform")
    return prev.propType !== next.propType;
  if (prev.kind === "chat" && next.kind === "chat") return prev.text !== next.text;
  return false;
}

export interface BotOptions {
  serverUrl: string;
  name: string;
  map: MapId;
  code: string | null;
  difficulty: number;
  readyAtPlayers: number;
  policy: Policy;
  visibility: Visibility;
  trace: Trace | null;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: timeout after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * The async/sync bridge. Every 20 Hz tick runs the synchronous reflex against
 * the current intent (never awaits); a single-flight, abortable `decide` runs in
 * the background at ~1.4 Hz or on events and swaps the intent in when it lands —
 * stale results (a slow decide that resolved after a newer one started) are
 * dropped by sequence number, so the bot keeps moving fluidly on its last good
 * intent no matter how slow or flaky the policy is.
 */
export class Bot {
  private room: Room | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private readonly reflex: Reflex;

  private currentIntent: Intent = BOOTSTRAP_INTENT;
  private decideSeq = 0;
  private decideInFlight = false;
  private decideController: AbortController | null = null;
  private lastDecideAt = 0;
  private decideErrored = false;

  private spawnSynced = false;
  private lastTickAt = 0;
  private prevPhase: Phase = "lobby";

  private eventPhase: Phase = "lobby";
  private eventRole: Role = "prop";
  private eventHp = 0;
  private losIds = new Set<string>();

  constructor(private readonly options: BotOptions) {
    this.reflex = new Reflex(options.difficulty);
  }

  async connect(): Promise<void> {
    const client = new Client(this.options.serverUrl);
    const room = await withTimeout(
      this.options.code
        ? client.joinById(this.options.code, { name: this.options.name })
        : client.joinOrCreate(ROOM_NAME, { name: this.options.name, map: this.options.map }),
      CONNECT_TIMEOUT_MS,
      `bot ${this.options.name} connect`,
    );
    this.room = room;

    room.onMessage(MSG_MAP, (raw: unknown) => this.applyMap(raw));
    room.onMessage(MSG_TELEPORT, (message: unknown) => this.onTeleport(message));
    room.onMessage(MSG_KILL, (message: unknown) => this.onKill(message));
    for (const ignored of [MSG_TAUNT, MSG_CHAT, MSG_SHOT_RESULT]) {
      room.onMessage(ignored, () => {});
    }
    room.onError((code: number, message?: string) =>
      console.error(`[bot ${this.options.name}] room error ${code}: ${message ?? ""}`),
    );
    room.onLeave(() => {
      void this.stop();
    });
    room.send(MSG_MAP);

    this.lastTickAt = Date.now();
    this.ticker = setInterval(() => this.tick(), INPUT_SEND_RATE_MS);
  }

  async stop(): Promise<void> {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
    this.decideController?.abort();
    const room = this.room;
    this.room = null;
    if (this.options.trace) await this.options.trace.close();
    if (room) {
      try {
        await room.leave();
      } catch {
        /* room already closed during shutdown */
      }
    }
  }

  private applyMap(raw: unknown): void {
    let map: MapDefinition;
    try {
      map = parseMapDefinition(raw);
    } catch (error) {
      console.error(`[bot ${this.options.name}] ignoring invalid map: ${(error as Error).message}`);
      return;
    }
    this.reflex.setMap(map);
  }

  private onTeleport(message: unknown): void {
    if (typeof message !== "object" || message === null) return;
    const m = message as Record<string, unknown>;
    if (typeof m.x === "number" && typeof m.z === "number") {
      this.reflex.syncPosition(m.x, m.z);
      this.spawnSynced = true;
    }
  }

  private onKill(message: unknown): void {
    const trace = this.options.trace;
    if (!trace || typeof message !== "object" || message === null) return;
    const m = message as Record<string, unknown>;
    trace.recordKill(
      {
        byId: typeof m.byId === "string" ? m.byId : "",
        victimId: typeof m.victimId === "string" ? m.victimId : "",
        reason: typeof m.reason === "string" ? m.reason : "",
      },
      Date.now(),
    );
  }

  private tick(): void {
    const room = this.room;
    if (!room || !this.reflex.ready) return;

    const now = Date.now();
    const dt = Math.min(MAX_TICK_SECONDS, (now - this.lastTickAt) / 1000);
    this.lastTickAt = now;

    const world = snapshot(room.state, room.sessionId);
    const self = world.self;
    if (!self) return;

    if (!this.spawnSynced) {
      this.reflex.syncPosition(self.x, self.z, self.rot);
      this.spawnSynced = true;
    }

    if (world.phase !== this.prevPhase) {
      if (world.phase === "hiding") {
        this.currentIntent = BOOTSTRAP_INTENT;
        this.reflex.onIntentChanged();
      }
      if (world.phase === "round_end" && this.options.trace) {
        this.options.trace.recordRoundEnd(world.winner, now);
      }
      this.prevPhase = world.phase;
    }

    if (world.phase === "lobby") {
      const playerCount = world.others.length + 1;
      if (!self.ready && playerCount >= this.options.readyAtPlayers) {
        room.send(MSG_READY, { ready: true });
      }
      return;
    }

    if (!self.alive) return;

    const reflexWorld: ReflexWorld = { phase: world.phase, self, others: world.others };
    const motor = this.reflex.executeIntent(this.currentIntent, reflexWorld, dt, now);
    room.send(MSG_INPUT, motor.input);
    if (motor.transformTo && self.propType !== motor.transformTo) {
      room.send(MSG_TRANSFORM, { propType: motor.transformTo });
    }
    if (motor.shoot) {
      room.send(MSG_SHOOT, { origin: motor.shoot.origin, dir: motor.shoot.dir });
    }

    this.maybeKickDecide(reflexWorld, now);
  }

  private maybeKickDecide(world: ReflexWorld, now: number): void {
    if (this.decideInFlight) return;
    const due = now - this.lastDecideAt >= DECIDE_INTERVAL_MS;
    const event = this.detectEvent(world);
    if (!due && !event) return;
    this.launchDecide(world, now);
  }

  /** Cheap per-tick triggers that wake the policy early; ground-truth role here
   * is scheduling only (the policy still gets the visibility-filtered obs). */
  private detectEvent(world: ReflexWorld): boolean {
    const self = world.self;
    let event = false;

    if (world.phase !== this.eventPhase) {
      this.eventPhase = world.phase;
      event = true;
    }
    if (self.role !== this.eventRole) {
      this.eventRole = self.role;
      event = true;
    }
    if (self.hp < this.eventHp) event = true;
    this.eventHp = self.hp;

    if (this.detectLineOfSightGain(world)) event = true;
    if (this.reflex.consumeArrivalEvent()) event = true;
    if (this.reflex.consumeBlockedEvent()) event = true;

    return event;
  }

  private detectLineOfSightGain(world: ReflexWorld): boolean {
    const wantHostile: Role = world.self.role === "hunter" ? "prop" : "hunter";
    const seen = new Set<string>();
    let gained = false;
    for (const other of world.others) {
      if (!other.alive || other.role !== wantHostile) continue;
      const dist = Math.hypot(other.x - this.reflex.x, other.z - this.reflex.z);
      if (dist > BOT_VISION_RANGE || !this.reflex.canSee(other.x, other.z)) continue;
      seen.add(other.id);
      if (!this.losIds.has(other.id)) gained = true;
    }
    this.losIds = seen;
    return gained;
  }

  private launchDecide(world: ReflexWorld, now: number): void {
    const seq = ++this.decideSeq;
    const controller = new AbortController();
    this.decideController = controller;
    this.decideInFlight = true;
    this.lastDecideAt = now;
    const obs = this.reflex.buildObservation(world, seq, this.options.visibility, now);
    const timer = setTimeout(() => controller.abort(), DECIDE_TIMEOUT_MS);

    this.options.policy
      .decide(obs, controller.signal)
      .then((intent) => this.onDecided(intent, obs))
      .catch((error: unknown) => this.onDecideError(error))
      .finally(() => {
        clearTimeout(timer);
        this.decideInFlight = false;
      });
  }

  private onDecided(intent: Intent, obs: Observation): void {
    if (intent.seq !== this.decideSeq) return;
    this.decideErrored = false;
    const changed = behaviorChanged(this.currentIntent, intent);
    this.currentIntent = intent;
    if (changed) this.reflex.onIntentChanged();
    this.speak(intent);
    this.options.trace?.recordDecision(this.options.policy.name, obs, intent, Date.now());
  }

  private onDecideError(error: unknown): void {
    if (this.decideErrored) return;
    this.decideErrored = true;
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`[bot ${this.options.name}] decide failed, holding last intent — ${detail}`);
  }

  private speak(intent: Intent): void {
    const text = intent.kind === "chat" ? intent.text : intent.say;
    if (text && this.room) this.room.send(MSG_CHAT, { text });
  }
}
