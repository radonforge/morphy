import {
  type Intent,
  type MapBounds,
  type Observation,
  type ObservedEntity,
  type ObservedSound,
  type Phase,
  type Role,
  TAUNT_DARING_RADIUS,
} from "@morphy/shared";
import {
  ENGAGE_RANGE_MAX,
  ENGAGE_RANGE_MIN,
  FLEE_DEFLECTION_RAD,
  FREEZE_RADIUS,
  HIDE_OFFSET_MAX,
  HIDE_OFFSET_MIN,
  lerp,
  MAX_FLEE_DEFLECTIONS,
  MAX_HIDE_REPICKS,
  PANIC_RADIUS,
  SONAR_PATIENCE_DECISIONS,
  TAUNT_CHANCE_MAX,
  TAUNT_CHANCE_MIN,
  TAUNT_DARING_CHANCE_MAX,
  TAUNT_DARING_CHANCE_MIN,
  WAYPOINT_MARGIN,
} from "../config";
import type { Policy } from "./types";

interface Spot {
  x: number;
  z: number;
}

/**
 * What a prop runs from or freezes before: a contact that might be a hunter,
 * or a sonar pulse, which only a hunter sends.
 */
interface Threat {
  x: number;
  z: number;
  distance: number;
  facingMe?: boolean;
}

/** A heard taunt the hunter is running to, named by its sound id. */
interface Lead extends Spot {
  id: string;
}

/**
 * Whether a contact is a disguise in sight that gave itself away within the
 * last few seconds: moved, changed shape or honked. Only such a disguise is a
 * suspect; one that did none of these reads exactly as the furniture around it.
 */
function isSuspect(entity: ObservedEntity): boolean {
  return entity.hasLineOfSight && entity.disguised === true && entity.tellRecently === true;
}

/**
 * Whether a contact is a disguise *seen* to be on the move: the one suspect
 * worth sprinting after, because it is the one a walking hunter can never catch:
 * a panicking prop runs at `MOVE_SPEED * RUN_MULTIPLIER_PROP` and a walking
 * approach closes at `MOVE_SPEED`, so the gap opens for as long as it keeps
 * running.
 *
 * Every other suspect is approached at walking pace on purpose. A contact known
 * only by sound carries no shape, so sprinting at one means sprinting at a
 * teammate's footsteps: the hunter pack, back again and faster.
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
 * - `"full"` reads ground truth (role/alive/propType), the parity anchor against
 *   which limited-vision LLM policies are measured (the former `HunterBrain`/`PropBrain`).
 * - `"limited"` reasons only from sensed signals (line of sight, distance,
 *   `disguised`, `movedRecently`, `tellRecently`), so the hunter is no longer
 *   omniscient: it must explore to find props rather than read `role` off them.
 *   A hunter is never disguised, so a contact *seen* to wear no disguise is a
 *   teammate and is neither shot at nor walked up to. Every disguise in sight
 *   is either a suspect (it moved, changed shape or honked a moment ago) or one
 *   more object in the room, since scene props, decoys and still props are
 *   listed alike. A suspect standing still is shot, and one still moving is run
 *   down (`inspect`) until it settles. With no suspect, and once its probe
 *   cadence allows, it tests the nearest object in reach it has not tested yet
 *   by shooting it, and pays the miss damage a player pays when that was
 *   furniture. A contact known only by sound carries no shape at all and is
 *   investigated whoever it turns out to be; a player hearing footsteps knows
 *   no better. A heard taunt can only be a prop's, so it is run to, after a
 *   suspect in sight and before a noise that might be a teammate's footsteps.
 *   With nothing to follow for a while it sounds its sonar, which makes the
 *   props close by honk.
 * - A prop that breaks cover while the hunt is on drops a decoy where it
 *   stood, so the hunter bearing down on it finds a double in its place.
 * - A prop settled in its hiding spot taunts for points now and then, never
 *   with a possible hunter in sight, and only rarely with one close but blind
 *   to it, which is worth more and far riskier. A sonar pulse it hears is a
 *   hunter close by: it runs if that is too close and otherwise holds still.
 *
 * It picks *what* to do; the reflex still owns aim, the line-of-sight gate and the
 * fire cooldown, and difficulty still tunes trigger latency inside the reflex.
 */
export class ScriptedPolicy implements Policy {
  readonly name = "scripted";

  private hideSpot: Spot | null = null;
  private hideRepicks = 0;
  private fleeSpot: Spot | null = null;
  private fleeDeflections = 0;
  private lead: Lead | null = null;
  private readonly followed = new Set<string>();
  private probeTarget: string | null = null;
  private readonly probed = new Set<string>();
  private quietDecisions = 0;
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
    const shootable = nearest(
      obs.entities,
      (e) => isSuspect(e) && !e.movedRecently && e.distance <= engageRange,
    );
    const suspect = this.nearestSuspect(obs);
    const lead = this.followTaunt(obs);
    this.settleProbe(obs);
    this.quietDecisions = shootable || suspect || lead ? 0 : this.quietDecisions + 1;
    if (shootable) return { kind: "shootTarget", targetId: shootable.id, seq };
    if (suspect?.hasLineOfSight) {
      return { kind: "inspect", targetId: suspect.id, run: isFleeing(suspect), seq };
    }
    if (lead) return { kind: "moveTo", x: lead.x, z: lead.z, run: true, seq };
    if (suspect) return { kind: "inspect", targetId: suspect.id, run: isFleeing(suspect), seq };
    const probe = this.pickProbe(obs, engageRange);
    if (probe) return { kind: "shootTarget", targetId: probe.id, seq };
    const intent: Intent = { kind: "patrol", seq };
    if (this.quietDecisions >= SONAR_PATIENCE_DECISIONS && obs.self.canSonarNow) {
      intent.act = "sonar";
      this.quietDecisions = 0;
    }
    return intent;
  }

  /** Once the bot has fired, the object it was testing counts as tested. */
  private settleProbe(obs: Observation): void {
    if (obs.self.canProbeNow || this.probeTarget === null) return;
    this.probed.add(this.probeTarget);
    this.probeTarget = null;
  }

  /**
   * The object in reach to test with a shot, held until the shot is fired: the
   * nearest disguise in sight that gave nothing away and has not been tested
   * yet. A player tests the scene the same way, and remembers which crates it
   * already shot, since one that survived a shot is furniture. The cadence is
   * the reflex's `canProbeNow`, so a bot never tests faster than it can afford.
   */
  private pickProbe(obs: Observation, engageRange: number): ObservedEntity | null {
    if (!obs.self.canProbeNow) return null;
    const held = obs.entities.find((e) => e.id === this.probeTarget);
    if (held?.hasLineOfSight && held.distance <= engageRange) return held;
    const pick = nearest(
      obs.entities,
      (e) =>
        e.hasLineOfSight &&
        e.disguised === true &&
        e.tellRecently !== true &&
        e.distance <= engageRange &&
        !this.probed.has(e.id),
    );
    this.probeTarget = pick?.id ?? null;
    return pick;
  }

  /**
   * The taunt worth running to: the most recent one not yet followed. Only a
   * prop honks, so unlike footsteps a taunt is surely an enemy's. The lead is
   * held until the hunter gets there or finds the way blocked, then dropped,
   * and what is in sight from the spot takes over.
   */
  private followTaunt(obs: Observation): Lead | null {
    if (this.lead && (obs.arrived || obs.pathBlocked)) {
      this.followed.add(this.lead.id);
      this.lead = null;
    }
    const heard = new Set(obs.sounds.map((sound) => sound.id));
    for (const id of [...this.followed]) {
      if (!heard.has(id)) this.followed.delete(id);
    }
    let newest: ObservedSound | null = null;
    for (const sound of obs.sounds) {
      if (sound.kind !== "taunt" || this.followed.has(sound.id)) continue;
      if (!newest || sound.ageMs < newest.ageMs) newest = sound;
    }
    if (newest && newest.id !== this.lead?.id) {
      this.lead = { id: newest.id, x: newest.x, z: newest.z };
    }
    return this.lead;
  }

  /**
   * The nearest contact worth going to look at: a suspect that is out of range or
   * still moving, or a contact whose shape is unknown because it was only heard.
   * A disguise in sight that gave nothing away is no suspect: it is one more
   * object in the room, and the probe is what tests those.
   *
   * Only a contact *seen* to be undisguised is excluded, and that exclusion is
   * the whole reason a pack of hunters no longer forms. A hunter renders as a
   * character with a weapon and can never come to look like a prop, so treating
   * it as a suspect meant two hunters picked each other, met, and stared at each
   * other for the rest of the round, and chased any human hunter who walked
   * past, forever, since a contact that keeps its distance never runs out of
   * patience to spend. A noise stays worth investigating precisely because a
   * player cannot tell a teammate's footsteps from a prop's.
   */
  private nearestSuspect(obs: Observation): ObservedEntity | null {
    return nearest(obs.entities, (e) => e.disguised === undefined || isSuspect(e));
  }

  private prop(obs: Observation): Intent {
    const seq = obs.seq;
    if (obs.phase !== "hiding" && obs.phase !== "hunting") return { kind: "idle", seq };
    if (obs.pathBlocked) {
      this.hideSpot = null;
      this.hideRepicks += 1;
    } else {
      this.hideRepicks = 0;
    }
    this.ensureHidePlan(obs);
    const spot = this.hideSpot;
    if (!spot) return { kind: "idle", seq };

    const threat =
      obs.visibility === "limited" ? this.nearestThreatLimited(obs) : this.nearestHunter(obs);
    if (threat) {
      if (threat.facingMe === true && threat.distance < FREEZE_RADIUS) {
        this.clearFleePlan();
        return { kind: "idle", seq };
      }
      if (threat.distance < PANIC_RADIUS) {
        this.clearHidePlan();
        const breakingCover = this.fleeSpot === null && obs.phase === "hunting";
        const flee = this.ensureFleePlan(obs, threat);
        const intent: Intent = { kind: "moveTo", x: flee.x, z: flee.z, run: true, seq };
        if (breakingCover) intent.act = "decoy";
        return intent;
      }
    }
    this.clearFleePlan();
    const intent: Intent = { kind: "hideAs", x: spot.x, z: spot.z, seq };
    if (this.wantsToTaunt(obs, threat)) intent.act = "taunt";
    return intent;
  }

  /**
   * Whether a prop settled in its hiding spot honks now. Never with a possible
   * hunter in sight: the honk would point straight at the prop. With one inside
   * {@link TAUNT_DARING_RADIUS} that cannot see it the taunt is worth three
   * times as much and the capture far likelier, so it is taken far less often.
   */
  private wantsToTaunt(obs: Observation, threat: Threat | null): boolean {
    if (obs.phase !== "hunting" || !obs.arrived || !obs.self.canTauntNow) return false;
    if (obs.sounds.some((sound) => sound.kind === "sonar")) return false;
    const watched = obs.entities.some(
      (e) =>
        e.hasLineOfSight &&
        (obs.visibility === "limited" ? e.disguised !== true : e.role === "hunter"),
    );
    if (watched) return false;
    const daring = threat !== null && threat.distance <= TAUNT_DARING_RADIUS;
    const chance = daring
      ? lerp(TAUNT_DARING_CHANCE_MIN, TAUNT_DARING_CHANCE_MAX, this.difficulty)
      : lerp(TAUNT_CHANCE_MIN, TAUNT_CHANCE_MAX, this.difficulty);
    return Math.random() < chance;
  }

  /** The nearest contact that might be a hunter: one seen not to be wearing a
   * disguise, or one only heard, since footsteps could be anyone's. A contact
   * seen to be disguised is a fellow prop, however much it happens to be moving,
   * and is no reason to break cover. */
  private nearestThreatLimited(obs: Observation): Threat | null {
    const contact = nearest(obs.entities, (e) => e.disguised !== true);
    let pulse: Threat | null = null;
    for (const sound of obs.sounds) {
      if (sound.kind !== "sonar") continue;
      if (!pulse || sound.distance < pulse.distance) pulse = sound;
    }
    if (!contact) return pulse;
    if (!pulse) return contact;
    return pulse.distance < contact.distance ? pulse : contact;
  }

  private nearestHunter(obs: Observation): ObservedEntity | null {
    return nearest(obs.entities, (e) => e.role === "hunter" && e.alive === true);
  }

  /**
   * The point the prop is running to, held until it is reached or the reflex
   * reports the path blocked. Recomputing it every decision let a cornered prop
   * re-issue a goal that drifted far enough to reset the reflex's replan
   * counter, so the blocked path never latched and it re-planned several times
   * per second without ever moving. Each blocked attempt swings the escape
   * further off the straight away-vector; once they are spent the prop stops
   * running, which is at least a reachable goal.
   *
   * Arrival has to release the plan as well, or the prop runs to its first
   * escape point and stands there for the rest of the round: the reflex parks
   * on a goal it has reached and only an intent it reads as *different* wakes
   * it, so re-issuing the spot it is already standing on leaves it settled.
   * The deflection count deliberately survives an arrival: resetting it would
   * let a cornered prop cycle back through fresh escapes forever, and once the
   * deflections are spent the fallback re-derives the prop's own position, so
   * the re-issued goal is unchanged and nothing churns.
   */
  private ensureFleePlan(obs: Observation, threat: Threat): Spot {
    if (this.fleeSpot && !obs.pathBlocked && !obs.arrived) return this.fleeSpot;
    if (obs.pathBlocked) this.fleeDeflections += 1;
    this.fleeSpot =
      this.fleeDeflections > MAX_FLEE_DEFLECTIONS
        ? { x: obs.self.x, z: obs.self.z }
        : this.fleeFrom(obs, threat, this.fleeDeflections * FLEE_DEFLECTION_RAD);
    return this.fleeSpot;
  }

  private clearFleePlan(): void {
    this.fleeSpot = null;
    this.fleeDeflections = 0;
  }

  private fleeFrom(obs: Observation, threat: Threat, deflection: number): Spot {
    const self = obs.self;
    let dx = self.x - threat.x;
    let dz = self.z - threat.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const cos = Math.cos(deflection);
    const sin = Math.sin(deflection);
    return this.clampToBounds(obs.map.bounds, {
      x: self.x + (dx * cos - dz * sin) * PANIC_RADIUS,
      z: self.z + (dx * sin + dz * cos) * PANIC_RADIUS,
    });
  }

  private ensureHidePlan(obs: Observation): void {
    if (this.hideSpot) return;
    const props = obs.map.nearbyProps;
    if (props.length > 0 && this.hideRepicks < MAX_HIDE_REPICKS) {
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
      if (obs.phase === "hiding") {
        this.clearHidePlan();
        this.clearFleePlan();
        this.hideRepicks = 0;
        this.lead = null;
        this.followed.clear();
        this.quietDecisions = 0;
        this.probeTarget = null;
        this.probed.clear();
      }
      this.prevPhase = obs.phase;
    }
    if (obs.self.role !== this.prevRole) {
      this.clearHidePlan();
      this.lead = null;
      this.prevRole = obs.self.role;
    }
  }

  private clearHidePlan(): void {
    this.hideSpot = null;
  }
}
