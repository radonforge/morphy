import type { LevelDocument } from "./document";

const LINE_WIDTH = 100;
const INDENT = 2;

function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(", ")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).map(([key, v]) => `${JSON.stringify(key)}: ${inline(v)}`);
    return entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
  }
  return JSON.stringify(value);
}

function print(value: unknown, indent: number, lead: number, trail: number): string {
  const flat = inline(value);
  const container = typeof value === "object" && value !== null;
  if (!container || indent + lead + flat.length + trail <= LINE_WIDTH) return flat;
  const inner = " ".repeat(indent + INDENT);
  const close = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map(
      (item, k) => `${inner}${print(item, indent + INDENT, 0, k < value.length - 1 ? 1 : 0)}`,
    );
    return `[\n${items.join(",\n")}\n${close}]`;
  }
  const entries = Object.entries(value);
  const lines = entries.map(([key, v], k) => {
    const head = `${JSON.stringify(key)}: `;
    return `${inner}${head}${print(v, indent + INDENT, head.length, k < entries.length - 1 ? 1 : 0)}`;
  });
  return `{\n${lines.join(",\n")}\n${close}}`;
}

/**
 * A level document as JSON text laid out the way the repo's formatter leaves it: a
 * value stays on one line while it fits in {@link LINE_WIDTH} columns and breaks one
 * entry per line otherwise, so a file written by a tool passes the format gate as is.
 */
export function formatLevelDocument(doc: LevelDocument): string {
  return `${print(doc, 0, 0, 0)}\n`;
}
