export type WeaponId = "pistol" | "shotgun" | "rifle";

export interface WeaponSpec {
  id: WeaponId;
  label: string;
  /** Flavor line shown in the weapon picker. */
  blurb: string;
  cooldownMs: number;
  range: number;
  /** Rays fired per shot; a shot captures if any pellet hits. */
  pellets: number;
  /** Max cone half-angle in radians applied to each pellet. */
  spreadRad: number;
  /** HP the hunter loses when every pellet misses. */
  missDamage: number;
  /** Viewmodel GLB, also used for tracer/audio identity client-side. */
  model: string;
  /** Client feel: recoil kick strength 0..1 and tracer color. */
  recoil: number;
  tracerColor: string;
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  pistol: {
    id: "pistol",
    label: "Pistol",
    blurb: "Balanced sidearm. Forgiving cooldown, honest range.",
    cooldownMs: 800,
    range: 30,
    pellets: 1,
    spreadRad: 0,
    missDamage: 20,
    model: "/models/blaster/blaster-c.glb",
    recoil: 0.6,
    tracerColor: "#fff34d",
  },
  shotgun: {
    id: "shotgun",
    label: "Scattergun",
    blurb: "Six pellets, short reach. Punishes a full miss hard.",
    cooldownMs: 1400,
    range: 14,
    pellets: 6,
    spreadRad: 0.09,
    missDamage: 25,
    model: "/models/blaster/blaster-p.glb",
    recoil: 1,
    tracerColor: "#ffab4d",
  },
  rifle: {
    id: "rifle",
    label: "Rifle",
    blurb: "Long reach, dead straight, slow. Wild shots cost dearly.",
    cooldownMs: 1600,
    range: 60,
    pellets: 1,
    spreadRad: 0,
    missDamage: 30,
    model: "/models/blaster/blaster-e.glb",
    recoil: 0.85,
    tracerColor: "#7de0ff",
  },
};

export const WEAPON_IDS: WeaponId[] = ["pistol", "shotgun", "rifle"];

export const DEFAULT_WEAPON: WeaponId = "pistol";

export function isWeaponId(value: unknown): value is WeaponId {
  return typeof value === "string" && Object.hasOwn(WEAPONS, value);
}
