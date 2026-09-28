import type { LevelDocument } from "./document";

const LINE_WIDTH = 100;
const INDENT = "  ";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function inline(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(", ")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    return `{ ${entries.map(([key, item]) => `${JSON.stringify(key)}: ${inline(item)}`).join(", ")} }`;
  }
  return JSON.stringify(value);
}

function opensUp(depth: number, key: string): boolean {
  return depth === 0 || (depth === 1 && key === "spawns");
}

function print(value: Json, depth: number, key: string, suffix: string): string[] {
  const pad = INDENT.repeat(depth);
  const prefix = key === "" ? "" : `${JSON.stringify(key)}: `;
  const flat = `${pad}${prefix}${inline(value)}${suffix}`;
  if (value === null || typeof value !== "object") return [flat];
  if (!opensUp(depth, key) && flat.length <= LINE_WIDTH) return [flat];
  const items: [string, Json][] = Array.isArray(value)
    ? value.map((item) => ["", item])
    : Object.entries(value);
  if (items.length === 0) return [flat];
  const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  return [
    `${pad}${prefix}${open}`,
    ...items.flatMap(([childKey, item], index) =>
      print(item, depth + 1, childKey, index < items.length - 1 ? "," : ""),
    ),
    `${pad}${close}${suffix}`,
  ];
}

/**
 * Serialise a level document the way the repo's formatter lays it out, so a
 * file written by a tool passes `biome ci` unchanged and diffs one entity per
 * line: the root and `spawns` always open up, and every other value stays on
 * one line while it fits the 100-column width.
 */
export function formatLevelDocument(doc: LevelDocument): string {
  return `${print(doc as unknown as Json, 0, "", "").join("\n")}\n`;
}
