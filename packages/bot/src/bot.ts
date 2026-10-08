import { Client, type Room } from "@colyseus/sdk";
import {
  type BotAct,
  INPUT_SEND_RATE_MS,
  type MapId,
  MSG_CHAT,
  MSG_DECOY,
  MSG_INPUT,
  MSG_KILL,
  MSG_MAP,
  MSG_PING,
  MSG_PONG,
  MSG_READY,
  MSG_SHOOT,
  MSG_SHOT_RESULT,
  MSG_SONAR,
  MSG_SONAR_PING,
  MSG_TAUNT,
  MSG_TAUNT_REQUEST,
  MSG_TELEPORT,
  parseMapDefinition,
  ROOM_NAME,
  type SoundKind,
  type Visibility,
  withTimeout,
} from "@morphy/shared";
import { CONNECT_TIMEOUT_MS } from "./config";
import { BotDriver } from "./driver";
import type { Policy } from "./policy/types";
import type { Trace } from "./trace";
import { snapshot } from "./view";

/** The client message each {@link BotAct} is sent as, the one a player's key press sends. */
const ACT_MESSAGES: Record<BotAct, string> = {
  decoy: MSG_DECOY,
  taunt: MSG_TAUNT_REQUEST,
  sonar: MSG_SONAR,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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

/**
 * The Colyseus transport for a {@link BotDriver}: it joins a room, feeds the
 * driver a snapshot of the synced state at {@link INPUT_SEND_RATE_MS} and ships
 * whatever the driver asks for back over the wire. All bot behaviour lives in
 * the driver, which the server drives against its own authoritative state.
 */
export class Bot {
  private room: Room | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private readonly driver: BotDriver;

  constructor(private readonly options: BotOptions) {
    this.driver = new BotDriver({
      name: options.name,
      difficulty: options.difficulty,
      readyAtPlayers: options.readyAtPlayers,
      policy: options.policy,
      visibility: options.visibility,
      trace: options.trace,
    });
  }

  async connect(): Promise<void> {
    const client = new Client(this.options.serverUrl);
    const room = await withTimeout(
      this.options.code
        ? client.joinById(this.options.code, { name: this.options.name })
        : client.joinOrCreate(ROOM_NAME, { name: this.options.name, map: this.options.map }),
      CONNECT_TIMEOUT_MS,
      `bot ${this.options.name} connect`,
      (lateRoom) => {
        void lateRoom.leave().catch((error: unknown) => {
          console.warn(`[bot ${this.options.name}] failed to leave late room`, error);
        });
      },
    );
    this.room = room;

    room.onMessage(MSG_MAP, (raw: unknown) => this.applyMap(raw));
    room.onMessage(MSG_TELEPORT, (message: unknown) => this.onTeleport(message));
    room.onMessage(MSG_KILL, (message: unknown) => this.onKill(message));
    room.onMessage(MSG_TAUNT, (message: unknown) => this.onSound("taunt", message, room.sessionId));
    room.onMessage(MSG_SONAR_PING, (message: unknown) =>
      this.onSound("sonar", message, room.sessionId),
    );
    room.onMessage(MSG_PING, (message: unknown) => {
      if (typeof message !== "object" || message === null) return;
      const n = (message as Record<string, unknown>).n;
      if (typeof n === "number" && Number.isFinite(n)) room.send(MSG_PONG, { n });
    });
    for (const ignored of [MSG_CHAT, MSG_SHOT_RESULT]) {
      room.onMessage(ignored, () => {});
    }
    room.onError((code: number, message?: string) =>
      console.error(`[bot ${this.options.name}] room error ${code}: ${message ?? ""}`),
    );
    room.onLeave(() => {
      void this.stop();
    });
    room.send(MSG_MAP);

    this.ticker = setInterval(() => this.tick(), INPUT_SEND_RATE_MS);
  }

  async stop(): Promise<void> {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
    await this.driver.stop();
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
    try {
      this.driver.setMap(parseMapDefinition(raw));
    } catch (error) {
      console.error(`[bot ${this.options.name}] ignoring invalid map: ${(error as Error).message}`);
    }
  }

  private onTeleport(message: unknown): void {
    if (typeof message !== "object" || message === null) return;
    const m = message as Record<string, unknown>;
    if (typeof m.x === "number" && typeof m.z === "number") {
      this.driver.syncPosition(m.x, m.z);
    }
  }

  private onSound(kind: SoundKind, message: unknown, selfId: string): void {
    if (typeof message !== "object" || message === null) return;
    const m = message as Record<string, unknown>;
    if (m.playerId === selfId) {
      if (kind === "taunt") this.driver.hearOwnHonk(Date.now());
      return;
    }
    if (!isFiniteNumber(m.x) || !isFiniteNumber(m.z)) return;
    this.driver.hear({ kind, x: m.x, z: m.z }, Date.now());
  }

  private onKill(message: unknown): void {
    if (typeof message !== "object" || message === null) return;
    const m = message as Record<string, unknown>;
    this.driver.recordKill(
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
    if (!room) return;
    const action = this.driver.tick(snapshot(room.state, room.sessionId), Date.now());
    if (action.ready) room.send(MSG_READY, { ready: true });
    if (action.act) room.send(ACT_MESSAGES[action.act]);
    if (action.input) room.send(MSG_INPUT, action.input);
    if (action.shoot) room.send(MSG_SHOOT, { dir: action.shoot.dir });
    if (action.say) room.send(MSG_CHAT, { text: action.say });
  }
}
