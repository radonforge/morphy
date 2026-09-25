import {
  type BotAct,
  type InputMessage,
  type Intent,
  type MapDefinition,
  type Observation,
  type Phase,
  type Role,
  type SoundKind,
  type Visibility,
  withTimeout,
} from "@morphy/shared";
import {
  ARRIVE_EPSILON,
  BOT_VISION_RANGE,
  DECIDE_INTERVAL_MS,
  DECIDE_TIMEOUT_MS,
  MAX_TICK_SECONDS,
} from "./config";
import { decoySource, playerSource } from "./contacts";
import type { Policy } from "./policy/types";
import type { Vec3 } from "./raycast";
import { Reflex, type ReflexWorld } from "./reflex";
import type { Trace } from "./trace";
import type { WorldSnapshot } from "./view";

const BOOTSTRAP_INTENT: Intent = { kind: "patrol", seq: 0 };

/**
 * Whether two intents differ in what the reflex should *do*, ignoring `seq`. A
 * new decision with the same behaviour (e.g. the same `hideAs` spot re-issued
 * every ~700ms) must NOT reset the reflex's path, or the bot re-plans and
 * micro-steps each cycle, the back-and-forth jitter while "parked".
 */
function behaviorChanged(prev: Intent, next: Intent): boolean {
  if (prev.kind !== next.kind) return true;
  if (prev.kind === "moveTo" && next.kind === "moveTo") {
    return prev.run !== next.run || Math.hypot(prev.x - next.x, prev.z - next.z) > ARRIVE_EPSILON;
  }
  if (prev.kind === "hideAs" && next.kind === "hideAs") {
    return Math.hypot(prev.x - next.x, prev.z - next.z) > ARRIVE_EPSILON;
  }
  if (prev.kind === "inspect" && next.kind === "inspect") return prev.targetId !== next.targetId;
  if (prev.kind === "shootTarget" && next.kind === "shootTarget")
    return prev.targetId !== next.targetId;
  if (prev.kind === "chat" && next.kind === "chat") return prev.text !== next.text;
  return false;
}

export interface BotDriverOptions {
  name: string;
  difficulty: number;
  readyAtPlayers: number;
  policy: Policy;
  visibility: Visibility;
  trace: Trace | null;
}

/** A sound the room played, at the spot a player's client plays it from. */
export interface RoomSound {
  kind: SoundKind;
  x: number;
  z: number;
}

/** What the caller must deliver to the room on behalf of the bot this tick. */
export interface DriverAction {
  ready: boolean;
  input: InputMessage | null;
  shoot: { dir: Vec3 } | null;
  say: string | null;
  act: BotAct | null;
}

const IDLE: DriverAction = { ready: false, input: null, shoot: null, say: null, act: null };

/**
 * The transport-free half of a bot: the reflex, the intent lifecycle and the
 * single-flight decision scheduler. Every tick runs the synchronous reflex
 * against the current intent (never awaits); an abortable `decide` runs in the
 * background at ~1.4 Hz or on events and swaps the intent in when it lands;
 * stale results (a slow decide that resolved after a newer one started) are
 * dropped by sequence number, so the bot keeps moving fluidly on its last good
 * intent no matter how slow or flaky the policy is.
 *
 * It reads a plain {@link WorldSnapshot} and returns a {@link DriverAction},
 * so the same behaviour drives both the CLI bot over the Colyseus SDK and the
 * server's own room-filling bots. Owning it once is the point: two copies of
 * this loop would drift apart.
 */
export class BotDriver {
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
  /** A decided chat line is only worth saying on the very next tick; a bot that dies or returns to the lobby first drops it rather than blurting it out a round later. */
  private pendingSay: string | null = null;
  /** A decided action is pressed on the next tick or not at all, for the same reason as {@link pendingSay}. */
  private pendingAct: BotAct | null = null;

  constructor(private readonly options: BotDriverOptions) {
    this.reflex = new Reflex(options.difficulty, options.visibility);
  }

  get ready(): boolean {
    return this.reflex.ready;
  }

  setMap(map: MapDefinition): void {
    this.reflex.setMap(map);
  }

  /** Adopt an authoritative position (spawn or teleport) instead of dead-reckoning to it. */
  syncPosition(x: number, z: number, rot?: number): void {
    this.reflex.syncPosition(x, z, rot);
    this.spawnSynced = true;
  }

  tick(world: WorldSnapshot, now: number): DriverAction {
    if (!this.reflex.ready) return IDLE;

    const dt =
      this.lastTickAt === 0 ? 0 : Math.min(MAX_TICK_SECONDS, (now - this.lastTickAt) / 1000);
    this.lastTickAt = now;

    const self = world.self;
    if (!self) return IDLE;

    if (!this.spawnSynced) {
      this.reflex.syncPosition(self.x, self.z, self.rot);
      this.spawnSynced = true;
    }

    if (world.phase !== this.prevPhase) {
      if (world.phase === "hiding") {
        this.currentIntent = BOOTSTRAP_INTENT;
        this.reflex.onIntentChanged();
        this.reflex.forgetContacts();
      }
      if (world.phase === "round_end" && this.options.trace) {
        this.options.trace.recordRoundEnd(world.winner, now);
      }
      this.prevPhase = world.phase;
    }

    if (world.phase === "lobby") {
      this.pendingSay = null;
      this.pendingAct = null;
      const playerCount = world.others.length + 1;
      const wantsReady = !self.ready && playerCount >= this.options.readyAtPlayers;
      return { ...IDLE, ready: wantsReady };
    }

    if (!self.alive) {
      this.pendingSay = null;
      this.pendingAct = null;
      return IDLE;
    }

    const reflexWorld: ReflexWorld = {
      phase: world.phase,
      self,
      others: world.others,
      decoys: world.decoys,
      clouds: world.clouds,
    };
    const motor = this.reflex.executeIntent(this.currentIntent, reflexWorld, dt, now);
    this.maybeKickDecide(reflexWorld, now);

    const say = this.pendingSay;
    const act = this.pendingAct;
    this.pendingSay = null;
    this.pendingAct = null;
    if (act) this.reflex.notePressed(act, now);
    return { ready: false, input: motor.input, shoot: motor.shoot, say, act };
  }

  /** Let the bot hear a sound the room played, as a player's client would play it. */
  hear(sound: RoomSound, now: number): void {
    this.reflex.hear(sound.kind, sound.x, sound.z, now);
  }

  recordKill(event: { byId: string; victimId: string; reason: string }, now: number): void {
    this.options.trace?.recordKill(event, now);
  }

  async stop(): Promise<void> {
    this.decideController?.abort();
    this.decideSeq += 1;
    this.decideInFlight = false;
    if (this.options.trace) await this.options.trace.close();
  }

  private maybeKickDecide(world: ReflexWorld, now: number): void {
    if (this.decideInFlight) return;
    const due = now - this.lastDecideAt >= DECIDE_INTERVAL_MS;
    const event = this.detectEvent(world);
    if (!due && !event) return;
    this.launchDecide(world, now);
  }

  /** Cheap per-tick triggers that wake the policy early. Reads the bot's *own*
   * state (phase, role, hp), which an observation always carries in full. */
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
    if (this.reflex.consumeHeardEvent()) event = true;

    return event;
  }

  /**
   * Wake the policy when *anyone* comes into view, not when an enemy does.
   * Filtering this on `other.role` gave the bot a reaction time no player has:
   * it stayed asleep while a teammate walked past and woke the instant a prop
   * appeared, before its policy had been told anything about either. Working
   * out who a contact is belongs to the policy, from the observation it is
   * allowed to see. Dead players are skipped because they are not rendered for
   * a human either, so they are not there to be noticed. A limited-vision bot
   * is woken by a decoy coming into view as well: it perceives one as a
   * disguise like any other, and sleeping through it would be a tell.
   */
  private detectLineOfSightGain(world: ReflexWorld): boolean {
    const seen = new Set<string>();
    const sighted: { source: string; x: number; y: number; z: number }[] = [];
    for (const other of world.others) {
      if (!other.alive) continue;
      sighted.push({ source: playerSource(other.id), x: other.x, y: other.y, z: other.z });
    }
    if (this.options.visibility === "limited") {
      for (const decoy of world.decoys) {
        sighted.push({ source: decoySource(decoy.id), x: decoy.x, y: decoy.y, z: decoy.z });
      }
    }
    let gained = false;
    for (const contact of sighted) {
      const dist = Math.hypot(contact.x - this.reflex.x, contact.z - this.reflex.z);
      if (dist > BOT_VISION_RANGE || !this.reflex.canSee(contact.x, contact.y, contact.z)) continue;
      seen.add(contact.source);
      if (!this.losIds.has(contact.source)) gained = true;
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
    const obs = this.reflex.buildObservation(world, seq, now);
    const timer = setTimeout(() => controller.abort(), DECIDE_TIMEOUT_MS);

    withTimeout(
      Promise.resolve().then(() => this.options.policy.decide(obs, controller.signal)),
      DECIDE_TIMEOUT_MS,
      `bot ${this.options.name} decision`,
    )
      .then((intent) => this.onDecided(intent, obs))
      .catch((error: unknown) => this.onDecideError(error))
      .finally(() => {
        clearTimeout(timer);
        if (this.decideController === controller) {
          this.decideController = null;
          this.decideInFlight = false;
        }
      });
  }

  private onDecided(intent: Intent, obs: Observation): void {
    if (intent.seq !== this.decideSeq) return;
    this.decideErrored = false;
    const speechChanged =
      this.currentIntent.say !== intent.say ||
      (this.currentIntent.kind === "chat" &&
        intent.kind === "chat" &&
        this.currentIntent.text !== intent.text);
    const changed = behaviorChanged(this.currentIntent, intent);
    this.currentIntent = intent;
    if (changed) this.reflex.onIntentChanged();
    if (changed || speechChanged) {
      this.pendingSay = intent.kind === "chat" ? intent.text : (intent.say ?? null);
    }
    if (intent.act) this.pendingAct = intent.act;
    this.options.trace?.recordDecision(this.options.policy.name, obs, intent, Date.now());
  }

  private onDecideError(error: unknown): void {
    if (this.decideErrored) return;
    this.decideErrored = true;
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`[bot ${this.options.name}] decide failed, holding last intent: ${detail}`);
  }
}
