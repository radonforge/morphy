import type { Intent, MapBounds, Observation, ObservedEntity, Phase, Role } from "@webhunt/shared";
import {
  ENGAGE_RANGE_MAX,
  ENGAGE_RANGE_MIN,
  FREEZE_RADIUS,
  HIDE_OFFSET_MAX,
  HIDE_OFFSET_MIN,
  PANIC_RADIUS,
  WAYPOINT_MARGIN,
  lerp,
} from "../config";
import type { Policy } from "./types";

interface Spot {
  x: number;
  z: number;
}

/**
 * The baseline brain, playable in both visibility modes:
 *
 * - `"full"` reads ground truth (role/alive/propType) — the parity anchor against
 *   which limited-vision LLM policies are measured (the former `HunterBrain`/`PropBrain`).
 * - `"limited"` reasons only from sensed signals (line of sight, distance,
 *   `looksLikeProp`, `movedRecently`), so the hunter is no longer omniscient: it
 *   must explore to find props and deduce who they are. Because a hunter is never
 *   disguised (`propType ""`), a `looksLikeProp` contact can only be a prop, so the
 *   hunter shoots those on sight and never wastes HP on a teammate; ambiguous movers
 *   get chased down (`inspect`) until they read as a static prop.
 *
 * It picks *what* to do; the reflex still owns aim, the line-of-sight gate and the
 * fire cooldown, and difficulty still tunes trigger latency inside the reflex.
 */
export class ScriptedPolicy implements Policy {
  readonly name = "scripted";

  private hideType: string | null = null;
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
    if (nearest) return { kind: "inspect", targetId: nearest.id, seq };
    return { kind: "patrol", seq };
  }

  private hunterLimited(obs: Observation): Intent {
    const seq = obs.seq;
    const engageRange = lerp(ENGAGE_RANGE_MIN, ENGAGE_RANGE_MAX, this.difficulty);
    const shootable = obs.entities
      .filter((e) => e.looksLikeProp === true && e.hasLineOfSight && e.distance <= engageRange)
      .sort((a, b) => a.distance - b.distance);
    if (shootable[0]) return { kind: "shootTarget", targetId: shootable[0].id, seq };
    const suspect = [...obs.entities].sort((a, b) => a.distance - b.distance)[0];
    if (suspect) return { kind: "inspect", targetId: suspect.id, seq };
    return { kind: "patrol", seq };
  }

  private prop(obs: Observation): Intent {
    const seq = obs.seq;
    if (obs.phase !== "hiding" && obs.phase !== "hunting") return { kind: "idle", seq };
    this.ensureHidePlan(obs);
    const spot = this.hideSpot;
    const type = this.hideType;
    if (!spot || !type) return { kind: "idle", seq };

    const threat = obs.visibility === "limited" ? this.nearestThreatLimited(obs) : this.nearestHunter(obs);
    if (threat) {
      if (threat.facingMe === true && threat.distance < FREEZE_RADIUS) {
        return { kind: "transform", propType: type, seq };
      }
      if (threat.distance < PANIC_RADIUS) {
        this.clearHidePlan();
        const flee = this.fleeFrom(obs, threat);
        return { kind: "moveTo", x: flee.x, z: flee.z, run: true, seq };
      }
    }
    return { kind: "hideAs", propType: type, x: spot.x, z: spot.z, seq };
  }

  private nearestThreatLimited(obs: Observation): ObservedEntity | null {
    let best: ObservedEntity | null = null;
    for (const e of obs.entities) {
      if (e.looksLikeProp === true) continue;
      if (!best || e.distance < best.distance) best = e;
    }
    return best;
  }

  private nearestHunter(obs: Observation): ObservedEntity | null {
    let best: ObservedEntity | null = null;
    for (const e of obs.entities) {
      if (e.role !== "hunter" || e.alive !== true) continue;
      if (!best || e.distance < best.distance) best = e;
    }
    return best;
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
    if (this.hideSpot && this.hideType) return;
    const props = obs.map.nearbyProps;
    if (props.length > 0) {
      const pick = props[Math.floor(Math.random() * props.length)]!;
      const angle = Math.random() * Math.PI * 2;
      const offset = HIDE_OFFSET_MIN + Math.random() * (HIDE_OFFSET_MAX - HIDE_OFFSET_MIN);
      this.hideType = pick.type;
      this.hideSpot = this.clampToBounds(obs.map.bounds, {
        x: pick.x + Math.cos(angle) * offset,
        z: pick.z + Math.sin(angle) * offset,
      });
      return;
    }
    const ids = obs.map.propCatalogIds;
    this.hideType = ids.length > 0 ? ids[Math.floor(Math.random() * ids.length)]! : null;
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
    this.hideType = null;
    this.hideSpot = null;
  }
}
