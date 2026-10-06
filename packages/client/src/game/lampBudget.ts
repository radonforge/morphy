/**
 * How much of a real light each lamp gets when only `budget` lights exist.
 *
 * The `budget` lamps nearest the focus are lit; each one's weight eases from 1 to
 * 0 (a smoothstep) as the nearest lamp left out draws within `fade` metres of it. A
 * light is therefore dark at the instant it changes lamp, and every lamp's weight
 * is a continuous function of the focus, so moving never pops a light on or off.
 * Lamps beyond the budget get 0.
 */
export function lampWeights(distances: readonly number[], budget: number, fade: number): number[] {
  const weights = distances.map(() => 0);
  if (budget <= 0) return weights;
  const order = distances.map((_, index) => index).sort((a, b) => distances[a]! - distances[b]!);
  const cutoff = order.length > budget ? distances[order[budget]!]! : Number.POSITIVE_INFINITY;
  for (const index of order.slice(0, budget)) {
    const margin = cutoff - distances[index]!;
    const t = fade > 0 ? Math.min(1, Math.max(0, margin / fade)) : 1;
    weights[index] = t * t * (3 - 2 * t);
  }
  return weights;
}
