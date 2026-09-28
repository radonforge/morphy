export function randRange(rng: () => number, min: number, max: number): number {
  return min + (max - min) * rng();
}

/** Uniformly pick one element of `arr` using `rng`. */
export function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]!;
}
