import { Client, type Room } from "@colyseus/sdk";
import {
  ROOM_NAME,
  INPUT_SEND_RATE_MS,
  MOVE_SPEED,
  RUN_MULTIPLIER_HUNTER,
  RUN_MULTIPLIER_PROP,
  FIRE_COOLDOWN_MS,
  MSG_INPUT,
  MSG_TRANSFORM,
  MSG_SHOOT,
  MSG_READY,
  MSG_MAP,
  MSG_TELEPORT,
  MSG_TAUNT,
  MSG_KILL,
  MSG_CHAT,
  MSG_SHOT_RESULT,
  computePropBounds,
  parseMapDefinition,
  type MapDefinition,
  type PropBounds,
  type Role,
} from "@webhunt/shared";
import {
  ARRIVE_EPSILON,
  AVOID_ANGLE,
  AVOID_MS,
  CONNECT_TIMEOUT_MS,
  STUCK_PROGRESS_FRACTION,
  STUCK_TICK_LIMIT,
} from "./config";
import { snapshot, type BotPlayer } from "./view";
import { buildObstacles, buildWalls, resolveCollisions, type Obstacle, type Wall } from "./collision";
import { HunterBrain, PropBrain, type Brain, type Decision } from "./behaviors";

const MAX_TICK_SECONDS = 0.25;

export interface BotOptions {
  serverUrl: string;
  name: string;
  difficulty: number;
  readyAtPlayers: number;
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

export class Bot {
  private room: Room | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private map: MapDefinition | null = null;
  private walls: Wall[] = [];
  private obstacles: Obstacle[] = [];
  private propBounds = new Map<string, PropBounds>();
  private posX = 0;
  private posZ = 0;
  private rot = 0;
  private spawnSynced = false;
  private lastTickAt = 0;
  private lastShotAt = 0;
  private prevPhase = "lobby";
  private brain: Brain = new PropBrain();
  private brainRole: Role = "prop";
  private stuckTicks = 0;
  private avoidUntil = 0;
  private avoidSign = 1;

  constructor(private readonly options: BotOptions) {}

  async connect(): Promise<void> {
    const client = new Client(this.options.serverUrl);
    const room = await withTimeout(
      client.joinOrCreate(ROOM_NAME, { name: this.options.name }),
      CONNECT_TIMEOUT_MS,
      `bot ${this.options.name} connect`,
    );
    this.room = room;

    room.onMessage(MSG_MAP, (raw: unknown) => this.applyMap(raw));
    room.onMessage(MSG_TELEPORT, (message: unknown) => this.onTeleport(message));
    for (const ignored of [MSG_TAUNT, MSG_KILL, MSG_CHAT, MSG_SHOT_RESULT]) {
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
    const room = this.room;
    this.room = null;
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
    this.map = map;
    this.walls = buildWalls(map);
    this.obstacles = buildObstacles(map);
    this.propBounds = new Map(map.propCatalog.map((def) => [def.id, computePropBounds(def)] as const));
  }

  private onTeleport(message: unknown): void {
    if (typeof message !== "object" || message === null) return;
    const m = message as Record<string, unknown>;
    if (typeof m.x === "number" && typeof m.z === "number") {
      this.posX = m.x;
      this.posZ = m.z;
      this.spawnSynced = true;
    }
  }

  private tick(): void {
    const room = this.room;
    const map = this.map;
    if (!room || !map) return;

    const now = Date.now();
    const dt = Math.min(MAX_TICK_SECONDS, (now - this.lastTickAt) / 1000);
    this.lastTickAt = now;

    const world = snapshot(room.state, room.sessionId);
    const self = world.self;
    if (!self) return;

    if (!this.spawnSynced) {
      this.posX = self.x;
      this.posZ = self.z;
      this.rot = self.rot;
      this.spawnSynced = true;
    }

    if (world.phase !== this.prevPhase) {
      if (world.phase === "hiding") this.brain.reset();
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

    this.syncBrainRole(self.role);
    const decision = this.brain.decide({
      phase: world.phase,
      self,
      others: world.others,
      map,
      propBounds: this.propBounds,
      difficulty: this.options.difficulty,
      now,
    });
    this.applyDecision(decision, self, map, dt, now, room);
  }

  private syncBrainRole(role: Role): void {
    if (role === this.brainRole) return;
    this.brainRole = role;
    this.brain = role === "hunter" ? new HunterBrain() : new PropBrain();
  }

  private applyDecision(
    decision: Decision,
    self: BotPlayer,
    map: MapDefinition,
    dt: number,
    now: number,
    room: Room,
  ): void {
    if (decision.move) {
      const toX = decision.move.x - this.posX;
      const toZ = decision.move.z - this.posZ;
      const dist = Math.hypot(toX, toZ);
      if (dist > 1e-4) {
        let dirX = toX / dist;
        let dirZ = toZ / dist;
        if (now < this.avoidUntil) {
          const angle = this.avoidSign * AVOID_ANGLE;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          [dirX, dirZ] = [dirX * cos - dirZ * sin, dirX * sin + dirZ * cos];
        }
        const runMultiplier = this.brainRole === "hunter" ? RUN_MULTIPLIER_HUNTER : RUN_MULTIPLIER_PROP;
        const speed = MOVE_SPEED * (decision.run ? runMultiplier : 1);
        const step = Math.min(dist, speed * dt);
        const prevX = this.posX;
        const prevZ = this.posZ;
        const resolved = resolveCollisions(
          { x: this.posX + dirX * step, z: this.posZ + dirZ * step },
          this.walls,
          this.obstacles,
          map.bounds,
        );
        this.posX = resolved.x;
        this.posZ = resolved.z;
        this.rot = Math.atan2(dirX, dirZ);

        const moved = Math.hypot(this.posX - prevX, this.posZ - prevZ);
        if (dist > ARRIVE_EPSILON && moved < step * STUCK_PROGRESS_FRACTION) {
          this.stuckTicks += 1;
          if (this.stuckTicks >= STUCK_TICK_LIMIT) {
            this.avoidUntil = now + AVOID_MS;
            this.avoidSign = -this.avoidSign;
            this.stuckTicks = 0;
          }
        } else {
          this.stuckTicks = 0;
        }
      }
    }
    if (decision.face !== null) this.rot = decision.face;

    room.send(MSG_INPUT, { x: this.posX, y: 0, z: this.posZ, rot: this.rot });

    if (decision.transformTo && self.propType !== decision.transformTo) {
      room.send(MSG_TRANSFORM, { propType: decision.transformTo });
    }

    if (decision.shoot && now - this.lastShotAt >= FIRE_COOLDOWN_MS) {
      this.lastShotAt = now;
      room.send(MSG_SHOOT, { origin: decision.shoot.origin, dir: decision.shoot.dir });
    }
  }
}
