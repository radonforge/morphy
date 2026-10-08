import {
  HIDE_DURATION_MS,
  type Intent,
  MOVE_SPEED,
  type Observation,
  type ObservedEntity,
  type ObservedSound,
  type Phase,
  type Role,
  RUN_MULTIPLIER_PROP,
  TAUNT_COOLDOWN_MS,
  TAUNT_DARING_RADIUS,
} from "@morphy/shared";
import {
  DECOY_RESERVE,
  DECOY_SPOT_RADIUS,
  ENGAGE_RANGE_MAX,
  ENGAGE_RANGE_MIN,
  ESCAPE_CLEAR_MS,
  ESCAPE_COMMIT_MAX_MS,
  ESCAPE_COMMIT_MIN_MS,
  ESCAPE_KEEP_RADIUS,
  ESCAPE_RETRY_MS,
  EXPOSED_MS,
  EXPOSED_RADIUS,
  FIRST_TAUNT_MAX_MS,
  FIRST_TAUNT_MIN_MS,
  HIDE_SEARCH_RADIUS,
  HIDE_TRAVEL_SHARE,
  lerp,
  MAX_HIDE_REPICKS,
  POINT_BLANK_RADIUS,
  PURSUIT_CLOSING,
  PURSUIT_MS,
  PURSUIT_RADIUS,
  REHIDE_CALM_MAX_MS,
  REHIDE_CALM_MIN_MS,
  REHIDE_MAX_PATH,
  REHIDE_SEARCH_RADIUS,
  SONAR_FLEE_RADIUS,
  SONAR_PATIENCE_DECISIONS,
  TAUNT_DARING_CHANCE_MAX,
  TAUNT_DARING_CHANCE_MIN,
  TAUNT_GAP_MAX_MS,
  TAUNT_GAP_MIN_MS,
  TAUNT_POSTPONE_MS,
  THREAT_MEMORY_MS,
} from "../config";
import type { Terrain } from "../terrain";
import { pickEscape } from "./escape";
import { pickHideSite } from "./hiding";
import type { Policy } from "./types";

const MS_PER_SECOND = 1_000;

interface Spot {
  x: number;
  z: number;
}

/** Where a prop means to hide, and which way to turn its disguise there when it knows. */
interface Plan extends Spot {
  yaw?: number;
}

/** A hunter the prop saw, where and when, and how long it has kept it in sight without a break. */
interface SeenHunter extends Spot {
  distance: number;
  facing: boolean;
  seenAt: number;
  /** When the current unbroken stretch of sight began, and how far off the hunter was then. */
  streakFrom: number | null;
  streakDistance: number;
}

/** A sonar pulse the prop heard, where and when: a hunter was there. */
interface HeardPulse extends Spot {
  heardAt: number;
}

/** A run for cover: the waypoint, when the prop may stop, and the waypoints it gave up on. */
interface Escape {
  spot: Spot;
  until: number;
  given: Spot[];
}

/** How hard pressed a running prop is: a hunter on top of it, or one that has spotted it. */
type Flight = "cornered" | "spotted";

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
 * worth sprinting after once it is out of reach, because it is the one a
 * walking hunter can never catch:
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
 * - A prop hides as the object it was dealt: beside objects of its own kind
 *   and turned like them, where the shape belongs (a wall-mounted one backed
 *   onto a wall), in cover and with a way out, drawn among the good spots so
 *   it does not take the same one every round. It plans from the map alone,
 *   never from where anyone else is.
 * - In the hunt it holds still while a hunter it can see is not on to it,
 *   runs once one is (at point blank, closing in on it, or seeing it within a
 *   moment of moving or honking), keeps running for a while and for as long
 *   as one keeps it in view, then hides again after a calm. It drops a decoy
 *   on its hiding spot as it breaks cover when it can spare one.
 * - It taunts for points on the hunt's clock, from its spot and never with a
 *   hunter in sight, and moves to a new spot after a honk it did not choose.
 *
 * It picks *what* to do; the reflex still owns aim, the line-of-sight gate and the
 * fire cooldown, and difficulty still tunes trigger latency inside the reflex.
 */
export class ScriptedPolicy implements Policy {
  readonly name = "scripted";

  private terrain: Terrain | null = null;
  private hide: Plan | null = null;
  private hideRepicks = 0;
  private settledAt: Spot | null = null;
  private escape: Escape | null = null;
  private calm: { since: number; wait: number } | null = null;
  private readonly hunters = new Map<string, SeenHunter>();
  private readonly pulses = new Map<string, HeardPulse>();
  private exposedAt = Number.NEGATIVE_INFINITY;
  private compromisedAt = Number.NEGATIVE_INFINITY;
  private relocatedFor = Number.NEGATIVE_INFINITY;
  private nextTauntAt: number | null = null;
  private noEscapeUntil = Number.NEGATIVE_INFINITY;
  private lastDecidedAt: number | null = null;
  private lastKind: Intent["kind"] | null = null;
  private moving = false;
  private wasMoving = false;
  private lead: Lead | null = null;
  private readonly followed = new Set<string>();
  private probeTarget: string | null = null;
  private readonly probed = new Set<string>();
  private quietDecisions = 0;
  private prevPhase: Phase | null = null;
  private prevRole: Role | null = null;

  constructor(private readonly difficulty: number) {}

  setTerrain(terrain: Terrain): void {
    this.terrain = terrain;
    this.forgetProp();
  }

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
    const shootable = nearest(obs.entities, (e) => isSuspect(e) && e.distance <= engageRange);
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
    if (probe) return { kind: "shootTarget", targetId: probe.id, probe: true, seq };
    const intent: Intent = { kind: "patrol", seq };
    if (this.quietDecisions >= SONAR_PATIENCE_DECISIONS && obs.self.canSonarNow) {
      intent.act = "sonar";
      this.quietDecisions = 0;
    }
    return intent;
  }

  /**
   * Once the bot has fired at the object it was testing, that object counts as
   * tested. A shot at anything else, a suspect that turned up first, leaves the
   * test pending: it spent the cadence, not the answer.
   */
  private settleProbe(obs: Observation): void {
    if (this.probeTarget === null || obs.self.lastShotTargetId !== this.probeTarget) return;
    if (obs.self.canProbeNow) return;
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
    if (obs.phase === "hiding") return this.remember(this.hideIntent(obs, null, null));
    if (obs.phase !== "hunting") return { kind: "idle", seq };
    const now = obs.phaseMs;
    this.wasMoving = this.moving && !obs.arrived;
    if (this.lastKind === "hideAs" && obs.arrived)
      this.settledAt = { x: obs.self.x, z: obs.self.z };
    this.perceiveHunters(obs, now);
    const inSight = this.huntersInSight(now);
    if (this.wasMoving && inSight.some((hunter) => hunter.facing)) this.exposedAt = now;
    this.noteHonks(obs, inSight, now);
    const flee = this.mustFlee(obs, inSight, now);
    return this.remember(this.propIntent(obs, inSight, flee, now));
  }

  /**
   * The prop's survival state: concealed while nothing threatens it, holding
   * still while a hunter it can see is not on to it (aim alone from a safe
   * distance proves nothing), escaping once one is, committed for a while
   * and for as long as a hunter keeps it in view, and hiding again after a
   * calm with nobody in sight. The bars to start running are higher than
   * those to keep running, so a chase is one run, not a stutter of starts and
   * stops at each decision.
   */
  private propIntent(
    obs: Observation,
    inSight: readonly SeenHunter[],
    flee: Flight | null,
    now: number,
  ): Intent {
    const seq = obs.seq;
    if (this.escape) {
      const pressed = flee !== null || this.stillPressed(obs, now);
      const running = this.continueEscape(obs, pressed, now);
      if (running) return running;
      this.escape = null;
      this.calm = { since: now, wait: lerp(REHIDE_CALM_MIN_MS, REHIDE_CALM_MAX_MS, Math.random()) };
      return { kind: "idle", seq };
    }
    if (flee) return this.startEscape(obs, flee, now);
    let leaving: Spot | null = null;
    if (this.calm) {
      if (inSight.length > 0) {
        this.calm.since = now;
        return { kind: "idle", seq };
      }
      if (now - this.calm.since < this.calm.wait) return { kind: "idle", seq };
      this.calm = null;
      this.hide = null;
      leaving = this.settledAt;
    }
    if (inSight.length > 0) return { kind: "idle", seq };
    if (this.compromisedAt > this.relocatedFor) return this.relocate(obs, now);
    return this.hideIntent(obs, now, leaving);
  }

  /**
   * Go to (or stay on) the hiding spot, picking one first if the prop has
   * none. While the hunters are blind it may run anywhere it reaches in the
   * time left; during the hunt it walks to one close by, away from the spot
   * it gave up and hidden from the hunters it perceived. A spot it could not
   * stand on (a decoy left there, say) is given up the same way. A settled
   * prop taunts when its next taunt falls due.
   */
  private hideIntent(obs: Observation, now: number | null, leaving: Spot | null): Intent {
    if (obs.pathBlocked && this.lastKind === "hideAs") {
      leaving ??= this.hide;
      this.hide = null;
      this.hideRepicks += 1;
    } else {
      this.hideRepicks = 0;
    }
    this.hide ??= this.pickHide(obs, now, leaving);
    const intent: Intent = { kind: "hideAs", x: this.hide.x, z: this.hide.z, seq: obs.seq };
    if (this.hide.yaw !== undefined) intent.yaw = this.hide.yaw;
    if (now !== null && this.wantsToTaunt(obs, now)) intent.act = "taunt";
    return intent;
  }

  private pickHide(obs: Observation, now: number | null, leaving: Spot | null): Plan {
    const here = { x: obs.self.x, z: obs.self.z };
    if (!this.terrain || this.hideRepicks >= MAX_HIDE_REPICKS) return here;
    const blind = obs.phase === "hiding";
    const hideLeftS = Math.max(0, HIDE_DURATION_MS - obs.phaseMs) / MS_PER_SECOND;
    const site = pickHideSite(
      this.terrain,
      {
        type: obs.self.propType,
        from: here,
        radius: blind ? HIDE_SEARCH_RADIUS : REHIDE_SEARCH_RADIUS,
        maxPath: blind
          ? hideLeftS * MOVE_SPEED * RUN_MULTIPLIER_PROP * HIDE_TRAVEL_SHARE
          : REHIDE_MAX_PATH,
        threats: now === null ? [] : this.threats(now),
        leaving,
      },
      Math.random,
    );
    return site ?? here;
  }

  /**
   * Move to a new spot once a honk the prop did not choose (one the room
   * forced, or one a hunter's sonar drew) has told the hunters roughly where
   * it is, leaving a decoy in the old spot when it can spare one: the honk
   * came from there, so that is where a hunter looks first.
   */
  private relocate(obs: Observation, now: number): Intent {
    this.relocatedFor = this.compromisedAt;
    const leaving = this.settledAt ?? { x: obs.self.x, z: obs.self.z };
    const decoy = this.canSpareDecoy(obs, DECOY_RESERVE);
    this.hide = null;
    const intent = this.hideIntent(obs, now, leaving);
    if (decoy && intent.act === undefined) intent.act = "decoy";
    return intent;
  }

  /**
   * Whether a prop drops a decoy as it leaves: only from its hiding spot,
   * where a double standing still is believable and nowhere near the way it
   * runs, only with one in stock and off cooldown as its HUD shows, and
   * keeping `reserve` back for a hunter at point blank.
   */
  private canSpareDecoy(obs: Observation, reserve: number): boolean {
    if (this.wasMoving || !this.settledAt || !obs.self.canDecoyNow) return false;
    if (obs.self.decoysLeft <= reserve) return false;
    return (
      Math.hypot(obs.self.x - this.settledAt.x, obs.self.z - this.settledAt.z) <= DECOY_SPOT_RADIUS
    );
  }

  /**
   * Break cover for the waypoint that best breaks sight of every threat the
   * prop perceived, committed for {@link ESCAPE_COMMIT_MIN_MS} to
   * {@link ESCAPE_COMMIT_MAX_MS}. A prop with nowhere to run holds still,
   * and looks for a way out again only after {@link ESCAPE_RETRY_MS}. A honk
   * it made before running is answered by the run, not by a move afterwards.
   */
  private startEscape(obs: Observation, flight: Flight, now: number): Intent {
    const seq = obs.seq;
    if (now < this.noEscapeUntil) return { kind: "idle", seq };
    const spot = this.escapeFrom(obs, now, []);
    if (!spot) {
      this.noEscapeUntil = now + ESCAPE_RETRY_MS;
      return { kind: "idle", seq };
    }
    this.relocatedFor = this.compromisedAt;
    this.escape = {
      spot,
      until: now + lerp(ESCAPE_COMMIT_MIN_MS, ESCAPE_COMMIT_MAX_MS, Math.random()),
      given: [],
    };
    this.hide = null;
    this.calm = null;
    const intent: Intent = { kind: "moveTo", x: spot.x, z: spot.z, run: true, seq };
    if (this.canSpareDecoy(obs, flight === "cornered" ? 0 : DECOY_RESERVE)) intent.act = "decoy";
    return intent;
  }

  /**
   * Keep running, or null once the escape is over: the waypoint reached with
   * nobody on the prop, or the commitment run out with no hunter in sight
   * close by. A blocked waypoint, or one reached with a hunter still on it,
   * is traded for the next best that is not one already given up.
   */
  private continueEscape(obs: Observation, pressed: boolean, now: number): Intent | null {
    const flight = this.escape;
    if (!flight) return null;
    const run = (spot: Spot): Intent => ({
      kind: "moveTo",
      x: spot.x,
      z: spot.z,
      run: true,
      seq: obs.seq,
    });
    if (obs.pathBlocked || obs.arrived) {
      if (!obs.pathBlocked && !pressed) return null;
      flight.given.push(flight.spot);
      const next = this.escapeFrom(obs, now, flight.given);
      if (!next) return null;
      flight.spot = next;
      return run(next);
    }
    if (now < flight.until || pressed) return run(flight.spot);
    return null;
  }

  /**
   * Whether a hunter close by is still on the running prop: one within
   * {@link ESCAPE_KEEP_RADIUS} that it saw within {@link ESCAPE_CLEAR_MS}. A
   * hunter that just dropped out of sight round a corner is still coming, and
   * a prop that stopped the moment it lost sight of it would only be caught
   * standing as it rounds the corner.
   */
  private stillPressed(obs: Observation, now: number): boolean {
    for (const hunter of this.hunters.values()) {
      if (now - hunter.seenAt > ESCAPE_CLEAR_MS) continue;
      if (Math.hypot(hunter.x - obs.self.x, hunter.z - obs.self.z) <= ESCAPE_KEEP_RADIUS) {
        return true;
      }
    }
    return false;
  }

  private escapeFrom(obs: Observation, now: number, avoid: readonly Spot[]): Spot | null {
    if (!this.terrain) return null;
    return pickEscape(this.terrain, {
      from: { x: obs.self.x, z: obs.self.z },
      type: obs.self.propType,
      threats: this.threats(now),
      avoid,
    });
  }

  /**
   * Whether the prop must run, and how hard pressed it is: a hunter in sight
   * aiming at it from point blank corners it; one
   * that has kept it in sight while closing in on it, looking its way, or
   * that is in sight within a moment of having watched it move or honk, has
   * spotted it; a sonar pulse right next to it is a hunter on top of it. A
   * hunter merely looking its way from further off is not: it holds still and
   * lets the hunter guess.
   */
  private mustFlee(obs: Observation, inSight: readonly SeenHunter[], now: number): Flight | null {
    let flight: Flight | null = null;
    for (const hunter of inSight) {
      const d = hunter.distance;
      if (hunter.facing && d <= POINT_BLANK_RADIUS) return "cornered";
      const pursuing =
        hunter.facing &&
        hunter.streakFrom !== null &&
        now - hunter.streakFrom >= PURSUIT_MS &&
        hunter.streakDistance - d >= PURSUIT_CLOSING &&
        d <= PURSUIT_RADIUS;
      const watched = now - this.exposedAt <= EXPOSED_MS && d <= EXPOSED_RADIUS;
      if (pursuing || watched) flight = "spotted";
    }
    if (obs.sounds.some((sound) => sound.kind === "sonar" && sound.distance <= SONAR_FLEE_RADIUS)) {
      flight ??= "spotted";
    }
    return flight;
  }

  /**
   * Remember each hunter in sight where it was seen, and for how long it has
   * been in sight without a break: a hunter lost and found again starts a new
   * stretch. Hunters not seen for {@link THREAT_MEMORY_MS} are forgotten.
   */
  private perceiveHunters(obs: Observation, now: number): void {
    for (const entity of obs.entities) {
      if (!this.isHunterInSight(obs, entity)) continue;
      const known = this.hunters.get(entity.id);
      const continued = known !== undefined && known.seenAt === this.lastDecidedAt;
      this.hunters.set(entity.id, {
        x: entity.x,
        z: entity.z,
        distance: entity.distance,
        facing: entity.facingMe === true,
        seenAt: now,
        streakFrom: continued ? known.streakFrom : now,
        streakDistance: continued ? known.streakDistance : entity.distance,
      });
    }
    for (const [id, hunter] of [...this.hunters]) {
      if (now - hunter.seenAt > THREAT_MEMORY_MS) this.hunters.delete(id);
    }
    this.lastDecidedAt = now;
  }

  private huntersInSight(now: number): SeenHunter[] {
    return [...this.hunters.values()].filter((hunter) => hunter.seenAt === now);
  }

  /**
   * A contact the prop sees that can only be a hunter: one seen wearing no
   * disguise. A fellow prop, however much it moves, is no reason to run, and a
   * rustle out of sight is another prop's: a hunter's footsteps are played to
   * nobody.
   */
  private isHunterInSight(obs: Observation, entity: ObservedEntity): boolean {
    if (!entity.hasLineOfSight) return false;
    return obs.visibility === "limited" ? entity.disguised === false : entity.role === "hunter";
  }

  /**
   * Remember every sonar pulse heard, a hunter's position, and note a honk the
   * prop's own disguise made that it did not choose: the room's forced taunt,
   * or the one a sonar close by draws. Either tells the hunters roughly where
   * it is, and one made in front of a hunter looking its way gave it away to
   * that hunter.
   */
  private noteHonks(obs: Observation, inSight: readonly SeenHunter[], now: number): void {
    for (const sound of obs.sounds) {
      if (sound.kind !== "sonar" || this.pulses.has(sound.id)) continue;
      this.pulses.set(sound.id, { x: sound.x, z: sound.z, heardAt: now });
    }
    const ago = obs.self.forcedHonkMsAgo;
    if (ago !== null && now - ago > this.compromisedAt) {
      this.compromisedAt = now - ago;
      this.nextTauntAt = Math.max(this.nextTauntAt ?? 0, now + this.drawTauntGap());
      if (inSight.some((hunter) => hunter.facing)) this.exposedAt = now;
    }
    for (const [id, pulse] of [...this.pulses]) {
      if (now - pulse.heardAt > THREAT_MEMORY_MS) this.pulses.delete(id);
    }
  }

  /** Where the prop believes hunters are: where it last saw each, and where it heard each recent pulse. */
  private threats(now: number): Spot[] {
    const spots: Spot[] = [];
    for (const hunter of this.hunters.values()) {
      if (now - hunter.seenAt <= THREAT_MEMORY_MS) spots.push({ x: hunter.x, z: hunter.z });
    }
    for (const pulse of this.pulses.values()) spots.push({ x: pulse.x, z: pulse.z });
    return spots;
  }

  /**
   * Whether a prop settled in its hiding spot honks now: once the next taunt
   * it drew falls due, never with a sonar just heard. With a hunter it knows
   * to be close the taunt is worth three times as much and the capture far
   * likelier, so it is taken with {@link TAUNT_DARING_CHANCE_MIN} to
   * {@link TAUNT_DARING_CHANCE_MAX} and otherwise put off a while. Timing is
   * on the hunt's clock, so it does not change with how often it is asked.
   */
  private wantsToTaunt(obs: Observation, now: number): boolean {
    if (!obs.arrived || !obs.self.canTauntNow) return false;
    if (this.nextTauntAt === null || now < this.nextTauntAt) return false;
    if (obs.sounds.some((sound) => sound.kind === "sonar")) return false;
    const here = { x: obs.self.x, z: obs.self.z };
    const daring = this.threats(now).some(
      (threat) => Math.hypot(threat.x - here.x, threat.z - here.z) <= TAUNT_DARING_RADIUS,
    );
    const chance = lerp(TAUNT_DARING_CHANCE_MIN, TAUNT_DARING_CHANCE_MAX, this.difficulty);
    if (daring && Math.random() >= chance) {
      this.nextTauntAt = now + TAUNT_POSTPONE_MS;
      return false;
    }
    this.nextTauntAt = now + this.drawTauntGap();
    return true;
  }

  private drawTauntGap(): number {
    return TAUNT_COOLDOWN_MS + lerp(TAUNT_GAP_MIN_MS, TAUNT_GAP_MAX_MS, Math.random());
  }

  private remember(intent: Intent): Intent {
    this.lastKind = intent.kind;
    this.moving = intent.kind === "moveTo" || intent.kind === "hideAs";
    return intent;
  }

  /**
   * Start each round afresh. A change of side is handled first, so the hunt's
   * own setup (its first taunt drawn) survives a prop dealt as the hunt opens.
   */
  private syncRoundState(obs: Observation): void {
    if (obs.self.role !== this.prevRole) {
      this.forgetProp();
      this.lead = null;
      this.prevRole = obs.self.role;
    }
    if (obs.phase !== this.prevPhase) {
      if (obs.phase === "hiding") {
        this.forgetProp();
        this.lead = null;
        this.followed.clear();
        this.quietDecisions = 0;
        this.probeTarget = null;
        this.probed.clear();
      }
      if (obs.phase === "hunting") {
        this.hunters.clear();
        this.nextTauntAt = lerp(FIRST_TAUNT_MIN_MS, FIRST_TAUNT_MAX_MS, Math.random());
      }
      this.prevPhase = obs.phase;
    }
  }

  /** Drop everything a prop planned and remembered, as a round begins or the bot changes side. */
  private forgetProp(): void {
    this.hide = null;
    this.hideRepicks = 0;
    this.settledAt = null;
    this.escape = null;
    this.calm = null;
    this.hunters.clear();
    this.pulses.clear();
    this.exposedAt = Number.NEGATIVE_INFINITY;
    this.compromisedAt = Number.NEGATIVE_INFINITY;
    this.relocatedFor = Number.NEGATIVE_INFINITY;
    this.nextTauntAt = null;
    this.noEscapeUntil = Number.NEGATIVE_INFINITY;
    this.lastDecidedAt = null;
    this.lastKind = null;
    this.moving = false;
    this.wasMoving = false;
  }
}
