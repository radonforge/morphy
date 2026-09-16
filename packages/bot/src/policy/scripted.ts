import type { Intent, MapBounds, Observation, ObservedEntity, Phase, Role } from "@morphy/shared";
import {
  ENGAGE_RANGE_MAX,
  ENGAGE_RANGE_MIN,
  FREEZE_RADIUS,
  HIDE_OFFSET_MAX,
  HIDE_OFFSET_MIN,
  lerp,
  PANIC_RADIUS,
  WAYPOINT_MARGIN,
} from "../config";
import type { Policy } from "./types";

interface Spot {
  x: number;
  z: number;
}

/**
 * Whether a contact is a disguise *seen* to be on the move — the one suspect
 * worth sprinting after, because it is the one a walking hunter can never catch:
 * a panicking prop runs at `MOVE_SPEED * RUN_MULTIPLIER_PROP` and a walking
 * approach closes at `MOVE_SPEED`, so the gap opens for as long as it keeps
 * running.
 *
 * Every other suspect is approached at walking pace on purpose. A contact known
 * only by sound carries no shape, so sprinting at one means sprinting at a
 * teammate's footsteps — the hunter pack, back again and faster.
 */
function isFleeing(entity: ObservedEntity): boolean {
  return entity.hasLineOfSight && entity.disguised === true && entity.movedRecently === true;
}

/** The closest sensed contact the caller cares about, or null if none qualifies. */
function nearest(
  entities: readonly ObservedEntity[],
  keep: (entity: ObservedEntity) => boolean,
): ObservedEntity | null {
  let best: ObservedEntity | null = null;
  for (const entity of entities) {
    if (!keep(entity)) continue;
    if (!best || entity.distance < best.distance) best = entity;
  }
  return best;
}

/**
 * The baseline brain, playable in both visibility modes:
 *
 * - `"full"` reads ground truth (role/alive/propType) — the parity anchor against
 *   which limited-vision LLM policies are measured (the former `HunterBrain`/`PropBrain`).
 * - `"limited"` reasons only from sensed signals (line of sight, distance,
 *   `disguised`, `movedRecently`), so the hunter is no longer omniscient: it must
 *   explore to find props rather than read `role` off them. A hunter is never
 *   disguised, so a contact *seen* to wear no disguise is a teammate and is
 *   neither shot at nor walked up to; a disguise standing still is shot on
 *   sight, and one still moving is run down (`inspect`) until it settles. A
 *   contact known only by sound carries no shape at all and is investigated
 *   whoever it turns out to be — a player hearing footsteps knows no better.
 *
 * It picks *what* to do; the reflex still owns aim, the line-of-sight gate and the
 * fire cooldown, and difficulty still tunes trigger latency inside the reflex.
 */
export class ScriptedPolicy implements Policy {
  readonly name = "scripted";

  private hideSpot: Spot | null = null;
  private prevPhase: Phase | null = null;
  private prevRole: Role | null = null;

  constructor(private readonly difficulty: number) {}

  async decide(obs: Observation): Promise<Intent> {
    this.syncRoundState(obs);
    return obs.self.role === "hunter" ? this.hunter(obs) : this.prop(obs);
  }

  private hunter(obs: Observation): Intent {
    if (obs.phase !== "hunting") return { kind: "idle", seq: obs.seq };
    return obs.visibility === "limited" ? this.hunterLimited(obs) : this.hunterFull(obs);
  }

  private hunterFull(obs: Observation): Intent {
    const seq = obs.seq;
    const engageRange = lerp(ENGAGE_RANGE_MIN, ENGAGE_RANGE_MAX, this.difficulty);
    const candidates = obs.entities
      .filter((e) => e.role === "prop" && e.alive === true && e.distance <= engageRange)
      .sort((a, b) => a.distance - b.distance);
    const visible = candidates.find((e) => e.hasLineOfSight);
    if (visible) return { kind: "shootTarget", targetId: visible.id, seq };
    const nearest = candidates[0];
    if (nearest) return { kind: "inspect", targetId: nearest.id, run: isFleeing(nearest), seq };
    return { kind: "patrol", seq };
  }

  private hunterLimited(obs: Observation): Intent {
    const seq = obs.seq;
    const engageRange = lerp(ENGAGE_RANGE_MIN, ENGAGE_RANGE_MAX, this.difficulty);
    const shootable = obs.entities
      .filter(
        (e) =>
          e.disguised === true && !e.movedRecently && e.hasLineOfSight && e.distance <= engageRange,
      )
      .sort((a, b) => a.distance - b.distance);
    if (shootable[0]) return { kind: "shootTarget", targetId: shootable[0].id, seq };
    const suspect = this.nearestSuspect(obs);
    if (suspect) return { kind: "inspect", targetId: suspect.id, run: isFleeing(suspect), seq };
    return { kind: "patrol", seq };
  }

  /**
   * The nearest contact worth going to look at: a disguise that is out of range or
   * still moving, or a contact whose shape is unknown because it was only heard.
   *
   * Only a contact *seen* to be undisguised is excluded, and that exclusion is
   * the whole reason a pack of hunters no longer forms. A hunter renders as a
   * character with a weapon and can never come to look like a prop, so treating
   * it as a suspect meant two hunters picked each other, met, and stared at each
   * other for the rest of the round — and chased any human hunter who walked
   * past, forever, since a contact that keeps its distance never runs out of
   * patience to spend. A noise stays worth investigating precisely because a
   * player cannot tell a teammate's footsteps from a prop's.
   */
  private nearestSuspect(obs: Observation): ObservedEntity | null {
    return nearest(obs.entities, (e) => e.disguised !== false);
  }

  private prop(obs: Observation): Intent {
    const seq = obs.seq;
    if (obs.phase !== "hiding" && obs.phase !== "hunting") return { kind: "idle", seq };
    if (obs.pathBlocked) this.clearHidePlan();
    this.ensureHidePlan(obs);
    const spot = this.hideSpot;
    if (!spot) return { kind: "idle", seq };

    const threat =
      obs.visibility === "limited" ? this.nearestThreatLimited(obs) : this.nearestHunter(obs);
    if (threat) {
      if (threat.facingMe === true && threat.distance < FREEZE_RADIUS) {
        return { kind: "idle", seq };
      }
      if (threat.distance < PANIC_RADIUS) {
        this.clearHidePlan();
        const flee = this.fleeFrom(obs, threat);
        return { kind: "moveTo", x: flee.x, z: flee.z, run: true, seq };
      }
    }
    return { kind: "hideAs", x: spot.x, z: spot.z, seq };
  }

  /** The nearest contact that might be a hunter: one seen not to be wearing a
   * disguise, or one only heard, since footsteps could be anyone's. A contact
   * seen to be disguised is a fellow prop, however much it happens to be moving,
   * and is no reason to break cover. */
  private nearestThreatLimited(obs: Observation): ObservedEntity | null {
    return nearest(obs.entities, (e) => e.disguised !== true);
  }

  private nearestHunter(obs: Observation): ObservedEntity | null {
    return nearest(obs.entities, (e) => e.role === "hunter" && e.alive === true);
  }

  private fleeFrom(obs: Observation, threat: ObservedEntity): Spot {
    const self = obs.self;
    let dx = self.x - threat.x;
    let dz = self.z - threat.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    return this.clampToBounds(obs.map.bounds, {
      x: self.x + dx * PANIC_RADIUS,
      z: self.z + dz * PANIC_RADIUS,
    });
  }

  private ensureHidePlan(obs: Observation): void {
    if (this.hideSpot) return;
    const props = obs.map.nearbyProps;
    if (props.length > 0) {
      const pick = props[Math.floor(Math.random() * props.length)]!;
      const angle = Math.random() * Math.PI * 2;
      const offset = HIDE_OFFSET_MIN + Math.random() * (HIDE_OFFSET_MAX - HIDE_OFFSET_MIN);
      this.hideSpot = this.clampToBounds(obs.map.bounds, {
        x: pick.x + Math.cos(angle) * offset,
        z: pick.z + Math.sin(angle) * offset,
      });
      return;
    }
    this.hideSpot = { x: obs.self.x, z: obs.self.z };
  }

  private clampToBounds(bounds: MapBounds, p: Spot): Spot {
    return {
      x: Math.min(Math.max(p.x, bounds.min.x + WAYPOINT_MARGIN), bounds.max.x - WAYPOINT_MARGIN),
      z: Math.min(Math.max(p.z, bounds.min.z + WAYPOINT_MARGIN), bounds.max.z - WAYPOINT_MARGIN),
    };
  }

  private syncRoundState(obs: Observation): void {
    if (obs.phase !== this.prevPhase) {
      if (obs.phase === "hiding") this.clearHidePlan();
      this.prevPhase = obs.phase;
    }
    if (obs.self.role !== this.prevRole) {
      this.clearHidePlan();
      this.prevRole = obs.self.role;
    }
  }

  private clearHidePlan(): void {
    this.hideSpot = null;
  }
}
