/** A selectable player avatar (cube-pet model rendered at `/models/pets/animal-<id>.glb`). */
export interface AvatarInfo {
  /** Stable id sent as the `avatar` join option and matched server-side. */
  id: string;
  /** Display name shown in the lobby picker. */
  name: string;
  /** Avatar set; pets ship today, humanoid characters are a planned second set. */
  set: "pet";
}

/**
 * The cube-pet avatars a player can pick from. Client renders the picker and the
 * in-game model from this list; the server validates the chosen id against it.
 * Three extra pet GLBs (bee, caterpillar, fish) exist on disk but are kept out of
 * the curated roster.
 */
export const AVATAR_CATALOG = [
  { id: "fox", name: "Volpe", set: "pet" },
  { id: "cat", name: "Gatto", set: "pet" },
  { id: "dog", name: "Cane", set: "pet" },
  { id: "panda", name: "Panda", set: "pet" },
  { id: "tiger", name: "Tigre", set: "pet" },
  { id: "lion", name: "Leone", set: "pet" },
  { id: "bunny", name: "Coniglio", set: "pet" },
  { id: "deer", name: "Cervo", set: "pet" },
  { id: "koala", name: "Koala", set: "pet" },
  { id: "penguin", name: "Pinguino", set: "pet" },
  { id: "parrot", name: "Pappagallo", set: "pet" },
  { id: "monkey", name: "Scimmia", set: "pet" },
  { id: "elephant", name: "Elefante", set: "pet" },
  { id: "giraffe", name: "Giraffa", set: "pet" },
  { id: "cow", name: "Mucca", set: "pet" },
  { id: "pig", name: "Maiale", set: "pet" },
  { id: "hog", name: "Cinghiale", set: "pet" },
  { id: "polar", name: "Orso polare", set: "pet" },
  { id: "beaver", name: "Castoro", set: "pet" },
  { id: "chick", name: "Pulcino", set: "pet" },
  { id: "crab", name: "Granchio", set: "pet" },
] as const satisfies readonly AvatarInfo[];

export type AvatarId = (typeof AVATAR_CATALOG)[number]["id"];

export const DEFAULT_AVATAR_ID: AvatarId = "fox";

/** Narrow an untrusted join option to a known avatar id (boundary validation). */
export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === "string" && AVATAR_CATALOG.some((entry) => entry.id === value);
}

/** Pick a random avatar id, used when a player joins without a valid choice. */
export function randomAvatarId(): AvatarId {
  const entry = AVATAR_CATALOG[Math.floor(Math.random() * AVATAR_CATALOG.length)];
  return entry?.id ?? DEFAULT_AVATAR_ID;
}
