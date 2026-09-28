import type { Finding } from "./checks";
import { compileLevel } from "./compile";
import type { LevelDocument, LevelLight, LevelPoint } from "./document";
import { TILE } from "./floorplan";
import { point } from "./format";
import { POSITION_SNAP, rectContains } from "./geometry";
import { DEFAULT_ROOM_LIGHT_COUNT, LIGHT_ID_PREFIX, pickDeckLights } from "./lights";
import type { OpResult } from "./ops";
import { wallRects } from "./walls";

const PROPOSAL_SEED = 0;

function fail(doc: LevelDocument, message: string, hint: string, entities: string[]): OpResult {
  return {
    doc,
    ok: false,
    findings: [{ code: "op.invalid", severity: "error", message, entities, hint }],
  };
}

function snap(value: number, free: boolean): number {
  return free ? value : Math.round(value / POSITION_SNAP) * POSITION_SNAP;
}

function describe(light: LevelLight): string {
  return `${light.id} (${light.kind}) at ${point(light)}`;
}

/** Why a light cannot stand at (`x`, `z`) in `doc`, or null when it can. */
function refusal(doc: LevelDocument, x: number, z: number): string | null {
  const halfW = (doc.grid.cols * TILE) / 2;
  const halfD = (doc.grid.rows * TILE) / 2;
  if (x < -halfW || x > halfW || z < -halfD || z > halfD) return "the map edge";
  if (wallRects(doc).some((wall) => rectContains(wall, x, z))) return "a wall";
  return null;
}

function nextLightId(doc: LevelDocument): string {
  const taken = new Set((doc.lights ?? []).map((light) => light.id));
  let n = 1;
  while (taken.has(`${LIGHT_ID_PREFIX}${n}`)) n++;
  return `${LIGHT_ID_PREFIX}${n}`;
}

function findLight(doc: LevelDocument, id: string): LevelLight | OpResult {
  const light = (doc.lights ?? []).find((entry) => entry.id === id);
  return light ?? fail(doc, `no light "${id}"`, "use pnpm level light list", [id]);
}

function blocked(doc: LevelDocument, light: LevelLight, blocker: string, hint: string): OpResult {
  return {
    doc,
    ok: false,
    findings: [
      {
        code: "op.blocked",
        severity: "error",
        message: `${describe(light)} would be inside ${blocker}`,
        entities: [light.id],
        hint,
      },
    ],
  };
}

/** Hang a new light at a point, snapped unless `free`; kind defaults to `room`, id to the first free `light-<n>`. */
export function addLight(
  doc: LevelDocument,
  args: { at: LevelPoint; kind?: LevelLight["kind"]; id?: string; free?: boolean },
): OpResult {
  const kind = args.kind ?? "room";
  const id = args.id ?? nextLightId(doc);
  if ((doc.lights ?? []).some((light) => light.id === id)) {
    return fail(doc, `id "${id}" is already used`, "pick another id", [id]);
  }
  if (id === "") return fail(doc, "a light needs a non-empty id", "pass --id with a name", []);
  if (!Number.isFinite(args.at.x) || !Number.isFinite(args.at.z)) {
    return fail(doc, "a light needs a finite position", "pass numeric x, z", [id]);
  }
  const free = args.free === true;
  const light: LevelLight = { id, kind, x: snap(args.at.x, free), z: snap(args.at.z, free) };
  const blocker = refusal(doc, light.x, light.z);
  if (blocker !== null) {
    return blocked(doc, light, blocker, "hang it over a room or a doorway instead");
  }
  return {
    doc: { ...doc, lights: [...(doc.lights ?? []), light] },
    ok: true,
    findings: [
      {
        code: "op.light-added",
        severity: "info",
        message: `added light ${describe(light)}`,
        entities: [id],
        at: { x: light.x, z: light.z },
      },
    ],
  };
}

/** Move a light to a point or by a delta, snapped unless `free`; fails when the spot is a wall or off the map. */
export function moveLight(
  doc: LevelDocument,
  args: { id: string; to?: LevelPoint; by?: LevelPoint; free?: boolean },
): OpResult {
  const light = findLight(doc, args.id);
  if ("doc" in light) return light;
  if ((args.to === undefined) === (args.by === undefined)) {
    return fail(doc, "a move needs exactly one of to or by", "pass --to x,z or --by dx,dz", [
      args.id,
    ]);
  }
  const target = args.to ?? { x: light.x + args.by!.x, z: light.z + args.by!.z };
  if (!Number.isFinite(target.x) || !Number.isFinite(target.z)) {
    return fail(doc, "a light needs a finite position", "pass numeric x, z", [args.id]);
  }
  const free = args.free === true;
  const next: LevelLight = { ...light, x: snap(target.x, free), z: snap(target.z, free) };
  const blocker = refusal(doc, next.x, next.z);
  if (blocker !== null) {
    return blocked(doc, next, blocker, "move it over a room or a doorway instead");
  }
  return {
    doc: {
      ...doc,
      lights: (doc.lights ?? []).map((entry) => (entry.id === next.id ? next : entry)),
    },
    ok: true,
    findings: [
      {
        code: "op.light-moved",
        severity: "info",
        message: `moved light ${describe(next)}`,
        entities: [next.id],
        at: { x: next.x, z: next.z },
      },
    ],
  };
}

/** Remove a light. */
export function removeLight(doc: LevelDocument, args: { id: string }): OpResult {
  const light = findLight(doc, args.id);
  if ("doc" in light) return light;
  return {
    doc: { ...doc, lights: (doc.lights ?? []).filter((entry) => entry.id !== args.id) },
    ok: true,
    findings: [
      {
        code: "op.light-removed",
        severity: "info",
        message: `removed light ${describe(light)}`,
        entities: [light.id],
      },
    ],
  };
}

/**
 * Replace the document's lights with what {@link pickDeckLights} proposes for its
 * layout: `roomCount` room lights (default {@link DEFAULT_ROOM_LIGHT_COUNT}) and one
 * corridor light per hunter spawn. Positions are the picker's own, not snapped.
 */
export function proposeLights(doc: LevelDocument, args: { roomCount?: number } = {}): OpResult {
  const roomCount = args.roomCount ?? DEFAULT_ROOM_LIGHT_COUNT;
  if (!Number.isInteger(roomCount) || roomCount < 0) {
    return fail(doc, "the room light count must be a whole number, 0 or more", "fix --rooms", []);
  }
  const map = compileLevel({ ...doc, lights: [] }, { catalog: [], seed: PROPOSAL_SEED });
  const lights = pickDeckLights(map, roomCount);
  const buried = buriedLight({ ...doc, lights });
  if (buried !== undefined) {
    return blocked(
      doc,
      buried,
      "a wall",
      "move the hunter spawn or the prop it hangs by out of the wall, then propose again",
    );
  }
  const findings: Finding[] = [
    {
      code: "op.lights-proposed",
      severity: "info",
      message: `replaced ${(doc.lights ?? []).length} lights with ${lights.length} proposed (${lights.filter((light) => light.kind === "room").length} room, ${lights.filter((light) => light.kind === "corridor").length} corridor)`,
      entities: [],
    },
  ];
  return { doc: { ...doc, lights }, ok: true, findings };
}

/** The first light of `doc` standing inside one of its walls, which the parser rejects. */
export function buriedLight(doc: LevelDocument): LevelLight | undefined {
  if (doc.lights === undefined) return undefined;
  const walls = wallRects(doc);
  return doc.lights.find((light) => walls.some((wall) => rectContains(wall, light.x, light.z)));
}

/**
 * Refuse an edit that leaves a light inside a wall, which the document parser would
 * reject: `next` when every light still stands clear, else a failure on `doc`.
 */
export function keepLightsClear(doc: LevelDocument, next: OpResult): OpResult {
  if (!next.ok) return next;
  const buried = buriedLight(next.doc);
  if (buried === undefined) return next;
  return blocked(
    doc,
    buried,
    "a wall the edit would raise",
    `move the light first with pnpm level light move ${buried.id} --to x,z`,
  );
}
