/** A selectable player avatar (cube-pet model rendered at `/models/pets/animal-<id>.glb`). */
export interface AvatarInfo {
  /** Stable id sent as the `avatar` join option and matched server-side. */
  id: string;
  /** Display name shown in the lobby picker. */
  name: string;
}

/**
 * The cube-pet avatars a player can pick from. Client renders the picker and the
 * in-game model from this list; the server validates the chosen id against it.
 * Three extra pet GLBs (bee, caterpillar, fish) exist on disk but are kept out of
 * the curated roster.
 */
export const AVATAR_CATALOG = [
  { id: "fox", name: "Fox" },
  { id: "cat", name: "Cat" },
  { id: "dog", name: "Dog" },
  { id: "panda", name: "Panda" },
  { id: "tiger", name: "Tiger" },
  { id: "lion", name: "Lion" },
  { id: "bunny", name: "Bunny" },
  { id: "deer", name: "Deer" },
  { id: "koala", name: "Koala" },
  { id: "penguin", name: "Penguin" },
  { id: "parrot", name: "Parrot" },
  { id: "monkey", name: "Monkey" },
  { id: "elephant", name: "Elephant" },
  { id: "giraffe", name: "Giraffe" },
  { id: "cow", name: "Cow" },
  { id: "pig", name: "Pig" },
  { id: "hog", name: "Boar" },
  { id: "polar", name: "Polar Bear" },
  { id: "beaver", name: "Beaver" },
  { id: "chick", name: "Chick" },
  { id: "crab", name: "Crab" },
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
