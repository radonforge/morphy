import {
  addLight,
  addRoom,
  type CellRect,
  compileLevel,
  doorKey,
  duplicateObject,
  type Finding,
  type LevelContext,
  type LevelDocument,
  LevelValidationError,
  levelOverlays,
  moveLight,
  moveObject,
  type OpResult,
  parseLevelDocument,
  placeObject,
  proposeLights,
  removeLight,
  removeObject,
  removeRoom,
  resizeRoom,
  rotateObject,
  type Side,
  TILE,
  toggleDoor,
  validateLevel,
} from "@morphy/level";
import {
  ASSET_CARDS,
  ASSET_TAGS,
  computePropBounds,
  MAP_CATALOG,
  type MapDefinition,
  type MapId,
  type PropDefinition,
  parseMapDefinition,
} from "@morphy/shared";
import {
  type DragEvent,
  type PointerEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import { themeFor } from "../game/Scene";
import { SERVER_URL } from "../net/endpoints";
import { onExternalLevelChange, saveLevel, waitForGameServerReload } from "./bridge";
import { type CheckItem, ChecksPanel, type OverlayToggles } from "./ChecksPanel";
import {
  type CanvasApi,
  EditorCanvas,
  type FocusMark,
  groundAt,
  type LightStyle,
} from "./EditorCanvas";
import {
  addedLightId,
  addedObjectId,
  addRoomRect,
  addSpawn,
  cellAt,
  changedEntities,
  deleteSpawn,
  type EditResult,
  edgeAt,
  fromOp,
  halfExtents,
  isRefusal,
  lightAt,
  moveRectEdge,
  moveSpawn,
  newRoomId,
  objectAt,
  opNotes,
  type RectEdge,
  rectBetween,
  rectEdgeAt,
  removeRoomRect,
  roomRectAt,
  type SpawnTeam,
  snapPosition,
  spawnAt,
  toGrid,
} from "./edits";
import {
  canRedo,
  canUndo,
  commit,
  commitMerged,
  createHistory,
  type History,
  redo,
  undo,
} from "./history";
import { Inspector } from "./Inspector";
import { PALETTE_MIME, Palette } from "./Palette";
import { type EditorView, EMPTY_PREVIEW, type Preview, type Selection, type Tool } from "./types";

const EDITOR_SEED = 1;
const EDGE_TOLERANCE = 0.2;
const RESIZE_TOLERANCE = 0.15;
const SPAWN_PICK_RADIUS = 0.9;
const LIGHT_PICK_RADIUS = 0.9;
const FREE_TURN_DEGREES = 5;
const DEGREES_PER_RADIAN = 180 / Math.PI;
const SPAWN_ENTITY = /^spawns\.(props|hunters)\[(\d+)\]$/;
const NO_OVERLAYS: OverlayToggles = { unreachable: false, sightlines: false, unique: false };
const ZOOM_SENSITIVITY = 0.0015;
const CLICK_SLOP_PX = 4;
const NOTICE_MS = 3200;
const WARNING_NOTICE_MS = 9000;
const RECENT_STEPS = 6;
const GHOST_RADIUS = 0.5;
const NO_HIGHLIGHTS: ReadonlySet<string> = new Set();

type NoticeTone = "info" | "warning";

/** The transient line over the plan: an op's refusal, a save, or a warning that stays up longer. */
interface Notice {
  message: string;
  tone: NoticeTone;
}

type Gesture =
  | { kind: "pan"; x: number; y: number }
  | { kind: "click"; x: number; y: number }
  | {
      kind: "move-object";
      base: LevelDocument;
      id: string;
      dx: number;
      dz: number;
      blocked: string | null;
    }
  | { kind: "move-spawn"; base: LevelDocument; team: SpawnTeam; index: number }
  | {
      kind: "move-light";
      base: LevelDocument;
      id: string;
      dx: number;
      dz: number;
      blocked: string | null;
    }
  | {
      kind: "resize";
      base: LevelDocument;
      roomId: string;
      index: number;
      edge: RectEdge;
      rect: CellRect;
    }
  | {
      kind: "paint";
      base: LevelDocument;
      start: { i: number; j: number };
      roomId: string | null;
      created: string | null;
    };

interface Compiled {
  map: MapDefinition | null;
  items: CheckItem[];
}

function rectCentre(doc: LevelDocument, rect: CellRect): { x: number; z: number } {
  const { halfW, halfD } = halfExtents(doc);
  return {
    x: -halfW + ((rect.i0 + rect.i1) / 2) * TILE,
    z: -halfD + ((rect.j0 + rect.j1) / 2) * TILE,
  };
}

function checkFromError(error: unknown, doc: LevelDocument): CheckItem {
  if (!(error instanceof LevelValidationError)) {
    return { severity: "error", message: error instanceof Error ? error.message : String(error) };
  }
  const item: CheckItem = { severity: "error", message: error.message, hint: error.hint };
  const [, kind, id] = /^(object|room|light) "(.*)"$/.exec(error.entityId) ?? [];
  if (kind === "object") {
    const object = doc.objects.find((candidate) => candidate.id === id);
    if (object) return { ...item, at: object, select: { kind: "object", id: object.id } };
  }
  if (kind === "light") {
    const light = doc.lights?.find((candidate) => candidate.id === id);
    if (light) return { ...item, at: light, select: { kind: "light", id: light.id } };
  }
  if (kind === "room" && id !== undefined) {
    const rect = doc.rooms.find((candidate) => candidate.id === id)?.rects[0];
    if (rect)
      return { ...item, at: rectCentre(doc, rect), select: { kind: "room", roomId: id, index: 0 } };
  }
  return item;
}

/** A check finding as a line of the panel, with what clicking it selects and where it pans to. */
function checkFromFinding(finding: Finding, doc: LevelDocument): CheckItem {
  const item: CheckItem = {
    severity: finding.severity,
    code: finding.code,
    message: finding.message,
    ...(finding.hint !== undefined ? { hint: finding.hint } : {}),
    ...(finding.at !== undefined ? { at: finding.at } : {}),
  };
  if (finding.code.startsWith("light.")) {
    const light = doc.lights?.find((candidate) => candidate.id === finding.entities[0]);
    if (light) return { at: light, ...item, select: { kind: "light", id: light.id } };
  }
  for (const entity of finding.entities) {
    const object = doc.objects.find((candidate) => candidate.id === entity);
    if (object) return { at: object, ...item, select: { kind: "object", id: object.id } };
    const room = doc.rooms.find((candidate) => candidate.id === entity);
    if (room?.rects[0]) {
      return {
        at: rectCentre(doc, room.rects[0]),
        ...item,
        select: { kind: "room", roomId: room.id, index: 0 },
      };
    }
    const [, team, index] = SPAWN_ENTITY.exec(entity) ?? [];
    if (team === "props" || team === "hunters") {
      const point = doc.spawns[team][Number(index)];
      if (point)
        return { at: point, ...item, select: { kind: "spawn", team, index: Number(index) } };
    }
  }
  return item;
}

function compileDoc(doc: LevelDocument, catalog: readonly PropDefinition[]): Compiled {
  try {
    const parsed = parseLevelDocument(doc, { catalog, id: doc.id });
    return {
      map: parseMapDefinition(compileLevel(parsed, { catalog, seed: EDITOR_SEED })),
      items: [],
    };
  } catch (error) {
    return { map: null, items: [checkFromError(error, doc)] };
  }
}

function externalLabel(changed: number, removed: number): string {
  const parts = [changed > 0 ? `${changed} changed` : "", removed > 0 ? `${removed} removed` : ""];
  return `External: ${parts.filter(Boolean).join(", ") || "no difference"}`;
}

function toolKey(tool: Tool): string {
  return tool.kind === "spawn" ? `spawn-${tool.team}` : tool.kind;
}

const TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: { kind: "select" }, label: "Select", key: "V" },
  { tool: { kind: "room" }, label: "Room", key: "R" },
  { tool: { kind: "door" }, label: "Door", key: "D" },
  { tool: { kind: "spawn", team: "props" }, label: "Prop spawn", key: "P" },
  { tool: { kind: "spawn", team: "hunters" }, label: "Hunter spawn", key: "H" },
  { tool: { kind: "light" }, label: "Lights", key: "L" },
];

export interface EditorProps {
  id: MapId;
  initial: LevelDocument;
  catalog: readonly PropDefinition[];
  onTry: () => void;
}

/**
 * The map editor: a full-screen plan of the level document with floating
 * toolbars. Every change is a step in one undo history, whether the author made
 * it here or a tool rewrote the file on disk; the latter are labelled external
 * and their entities highlighted until the next local edit.
 */
export function Editor({ id, initial, catalog, onTry }: EditorProps) {
  const [history, setHistory] = useState<History>(() => createHistory(initial));
  const [draft, setDraftState] = useState<LevelDocument | null>(null);
  const draftRef = useRef<LevelDocument | null>(null);
  const setDraft = useCallback((next: LevelDocument | null) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);
  const [savedDoc, setSavedDoc] = useState<LevelDocument>(initial);
  const [selection, setSelection] = useState<Selection>(null);
  const [tool, setTool] = useState<Tool>({ kind: "select" });
  const [view, setView] = useState<EditorView>("plan");
  const [ceilingShown, setCeilingShown] = useState(true);
  const [preview, setPreview] = useState<Preview>(EMPTY_PREVIEW);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [diskError, setDiskError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [focus, setFocus] = useState<FocusMark | null>(null);
  const [cursor, setCursor] = useState("default");
  const containerRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const spaceRef = useRef(false);
  const noticeTimer = useRef<number | undefined>(undefined);
  const reloadPending = useRef(false);
  const savingRef = useRef(false);
  const apiRef = useRef<CanvasApi>({
    camera: null,
    size: { width: 0, height: 0 },
    panBy: () => {},
    zoomAt: () => {},
    centerOn: () => {},
  });

  const doc = draft ?? history.present.doc;
  const dirty = history.present.doc !== savedDoc;
  const theme = useMemo(() => themeFor(id), [id]);
  const lightStyle = useMemo<LightStyle | null>(
    () =>
      theme.deckLights
        ? {
            room: theme.deckLights.roomColor,
            corridor: theme.deckLights.corridorColor,
            reach: theme.deckLights.distance,
          }
        : null,
    [theme],
  );
  const mapName = MAP_CATALOG.find((entry) => entry.id === id)?.name ?? id;
  const catalogById = useMemo(() => new Map(catalog.map((def) => [def.id, def])), [catalog]);
  const context = useMemo<LevelContext>(
    () => ({ catalog, cards: ASSET_CARDS, tags: ASSET_TAGS }),
    [catalog],
  );
  const [overlayToggles, setOverlayToggles] = useState<OverlayToggles>(NO_OVERLAYS);
  const radiusOf = useCallback(
    (type: string) => {
      const def = catalogById.get(type);
      return def ? computePropBounds(def).radius : GHOST_RADIUS;
    },
    [catalogById],
  );
  const compiled = useMemo(() => compileDoc(doc, catalog), [doc, catalog]);
  const lastMap = useRef<MapDefinition | null>(null);
  if (compiled.map) lastMap.current = compiled.map;
  const map = compiled.map ?? lastMap.current;
  const checked = useDeferredValue(history.present.doc);
  const report = useMemo(() => {
    try {
      return validateLevel(parseLevelDocument(checked, { catalog, id: checked.id }), context);
    } catch {
      return null;
    }
  }, [checked, catalog, context]);
  const overlays = useMemo(() => {
    if (!report || !(overlayToggles.unreachable || overlayToggles.sightlines)) return null;
    return levelOverlays(checked, context);
  }, [report, overlayToggles.unreachable, overlayToggles.sightlines, checked, context]);
  const uniqueIds = useMemo<ReadonlySet<string>>(
    () =>
      new Set(
        (report?.findings ?? [])
          .filter((finding) => finding.code === "object.unique-type")
          .map((finding) => finding.entities[0]!),
      ),
    [report],
  );
  const items = useMemo<CheckItem[]>(
    () => [
      ...(diskError
        ? [
            {
              severity: "error" as const,
              message: `The file on disk does not parse: ${diskError}`,
            },
          ]
        : []),
      ...compiled.items,
      ...(report?.findings ?? []).map((finding) => checkFromFinding(finding, checked)),
    ],
    [diskError, compiled.items, report, checked],
  );
  const highlights = useMemo<ReadonlySet<string>>(
    () =>
      history.present.source === "external" ? new Set(history.present.changed) : NO_HIGHLIGHTS,
    [history.present],
  );

  const notify = useCallback((message: string, tone: NoticeTone = "info") => {
    window.clearTimeout(noticeTimer.current);
    setNotice({ message, tone });
    noticeTimer.current = window.setTimeout(
      () => setNotice(null),
      tone === "warning" ? WARNING_NOTICE_MS : NOTICE_MS,
    );
  }, []);

  const commitLocal = useCallback((next: LevelDocument, label: string) => {
    setHistory((current) => commit(current, next, label, "local"));
  }, []);

  const applyResult = useCallback(
    (result: EditResult, label: string): boolean => {
      if (isRefusal(result)) {
        notify(`Cannot ${label.toLowerCase()}: ${result.refused}`);
        return false;
      }
      commitLocal(result, label);
      return true;
    },
    [commitLocal, notify],
  );

  const applyOp = useCallback(
    (result: OpResult, label: string): boolean => {
      if (!applyResult(fromOp(result), label)) return false;
      const notes = opNotes(result);
      if (notes.length > 0) notify(notes.join("; "));
      return true;
    },
    [applyResult, notify],
  );

  const latest = useRef({ history, savedDoc, selection, view, dirty, compiled });
  latest.current = { history, savedDoc, selection, view, dirty, compiled };

  const save = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) return false;
    const current = latest.current.history.present.doc;
    savingRef.current = true;
    setSaving(true);
    try {
      await saveLevel(current);
      setSavedDoc(current);
      reloadPending.current = true;
      setDiskError(null);
      notify("Saved to the repo");
      return true;
    } catch (error) {
      notify(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [notify]);

  const tryIt = useCallback(async () => {
    if (latest.current.compiled.map === null) {
      notify("Fix the checks before trying the map");
      return;
    }
    if (latest.current.dirty && !(await save())) return;
    if (reloadPending.current) {
      setSaving(true);
      setNotice({ message: "Waiting for the game server to load the saved map", tone: "info" });
      try {
        await waitForGameServerReload(SERVER_URL);
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error));
        return;
      } finally {
        setSaving(false);
      }
      reloadPending.current = false;
    }
    onTry();
  }, [notify, onTry, save]);

  useEffect(
    () =>
      onExternalLevelChange((payload) => {
        if (payload.id !== id) return;
        if ("error" in payload) {
          setDiskError(payload.error);
          return;
        }
        setDiskError(null);
        gestureRef.current = null;
        setDraft(null);
        setPreview(EMPTY_PREVIEW);
        reloadPending.current = true;
        const external = payload.document;
        if (JSON.stringify(external) === JSON.stringify(latest.current.history.present.doc)) {
          setSavedDoc(latest.current.history.present.doc);
          return;
        }
        setHistory((current) => {
          const { keys, removed } = changedEntities(current.present.doc, external);
          return commit(current, external, externalLabel(keys.length, removed), "external", keys);
        });
        const superseded = latest.current.dirty;
        setSavedDoc(external);
        if (superseded) {
          notify(
            "The file changed on disk and replaced your unsaved edits. Press Undo to get them back.",
            "warning",
          );
        } else {
          notify("The document changed on disk: applied as an external step");
        }
      }),
    [id, notify, setDraft],
  );

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (latest.current.dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const deleteSelection = useCallback(() => {
    const current = latest.current.history.present.doc;
    const selected = latest.current.selection;
    if (!selected) return;
    let deleted: boolean;
    if (selected.kind === "object") {
      deleted = applyOp(removeObject(current, { id: selected.id }), `Delete ${selected.id}`);
    } else if (selected.kind === "room") {
      const rects = current.rooms.find((room) => room.id === selected.roomId)?.rects.length ?? 0;
      deleted =
        rects > 1
          ? applyResult(
              removeRoomRect(current, selected.roomId, selected.index),
              `Delete ${selected.roomId}`,
            )
          : applyOp(removeRoom(current, { id: selected.roomId }), `Delete ${selected.roomId}`);
    } else if (selected.kind === "light") {
      deleted = applyOp(removeLight(current, { id: selected.id }), `Delete ${selected.id}`);
    } else {
      deleted = applyResult(deleteSpawn(current, selected.team, selected.index), "Delete spawn");
    }
    if (deleted) setSelection(null);
  }, [applyOp, applyResult]);

  const rotateSelection = useCallback(
    (direction: 1 | -1, free: boolean, repeat: boolean) => {
      const selected = latest.current.selection;
      if (selected?.kind !== "object") return;
      const base = latest.current.history.present.doc;
      const result = rotateObject(
        base,
        free
          ? { id: selected.id, degrees: direction * FREE_TURN_DEGREES }
          : { id: selected.id, turns: direction },
        context,
      );
      const next = fromOp(result);
      if (isRefusal(next)) {
        notify(`Cannot rotate ${selected.id}: ${next.refused}`);
        return;
      }
      const label = `Rotate ${selected.id}`;
      setHistory((current) => {
        if (current.present.doc !== base) return current;
        return repeat ? commitMerged(current, next, label) : commit(current, next, label, "local");
      });
    },
    [context, notify],
  );

  const duplicateSelection = useCallback(() => {
    const current = latest.current.history.present.doc;
    const selected = latest.current.selection;
    if (selected?.kind !== "object") return;
    const result = duplicateObject(current, { id: selected.id }, context);
    if (!applyOp(result, `Duplicate ${selected.id}`)) return;
    const copy = addedObjectId(current, result.doc);
    if (copy) setSelection({ kind: "object", id: copy });
  }, [applyOp, context]);

  const placeAgainstWall = useCallback(
    (objectId: string, side: Side) => {
      const current = latest.current.history.present.doc;
      const object = current.objects.find((candidate) => candidate.id === objectId);
      const room = object ? roomRectAt(current, object.x, object.z)?.roomId : undefined;
      if (!object || !room) {
        notify(`Cannot back ${objectId} onto a wall: it is not in a room`);
        return;
      }
      const removed = removeObject(current, { id: objectId });
      applyOp(
        placeObject(
          removed.doc,
          {
            type: object.type,
            id: object.id,
            relation: { againstWall: { room, side }, facing: "in" },
          },
          context,
        ),
        `Back ${objectId} onto the ${side} wall`,
      );
    },
    [applyOp, context, notify],
  );

  const setObjectPose = useCallback(
    (objectId: string, pose: { x?: number; z?: number; yawDegrees?: number }) => {
      const current = latest.current.history.present.doc;
      const object = current.objects.find((candidate) => candidate.id === objectId);
      if (!object) return;
      if (pose.yawDegrees !== undefined) {
        applyOp(
          rotateObject(
            current,
            { id: objectId, degrees: pose.yawDegrees - object.yaw * DEGREES_PER_RADIAN },
            context,
          ),
          `Rotate ${objectId}`,
        );
        return;
      }
      applyOp(
        moveObject(
          current,
          { id: objectId, to: { x: pose.x ?? object.x, z: pose.z ?? object.z }, free: true },
          context,
        ),
        `Move ${objectId}`,
      );
    },
    [applyOp, context],
  );

  const setLightPose = useCallback(
    (lightId: string, pose: { x?: number; z?: number }) => {
      const current = latest.current.history.present.doc;
      const light = current.lights?.find((candidate) => candidate.id === lightId);
      if (!light) return;
      applyOp(
        moveLight(current, {
          id: lightId,
          to: { x: pose.x ?? light.x, z: pose.z ?? light.z },
          free: true,
        }),
        `Move ${lightId}`,
      );
    },
    [applyOp],
  );

  const proposeAllLights = useCallback(() => {
    const current = latest.current.history.present.doc;
    if (applyOp(proposeLights(current), "Propose lights")) setSelection(null);
  }, [applyOp]);

  const dropGesture = useCallback(() => {
    gestureRef.current = null;
    setDraft(null);
    setPreview(EMPTY_PREVIEW);
  }, [setDraft]);

  const stepHistory = useCallback(
    (step: (history: History) => History) => {
      dropGesture();
      setHistory(step);
    },
    [dropGesture],
  );

  const cancel = useCallback(() => {
    dropGesture();
    setTool({ kind: "select" });
    setSelection(null);
  }, [dropGesture]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.code === "KeyS") {
        event.preventDefault();
        void save();
        return;
      }
      const typing =
        event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (typing) return;
      if (mod && event.code === "KeyZ") {
        event.preventDefault();
        stepHistory(event.shiftKey ? redo : undo);
        return;
      }
      if (mod && event.code === "KeyY") {
        event.preventDefault();
        stepHistory(redo);
        return;
      }
      if (mod && event.code === "KeyD") {
        event.preventDefault();
        if (!event.repeat) duplicateSelection();
        return;
      }
      if (mod) return;
      switch (event.code) {
        case "Tab":
          event.preventDefault();
          setView((current) => (current === "plan" ? "orbit" : "plan"));
          return;
        case "KeyQ":
          event.preventDefault();
          rotateSelection(1, event.altKey, event.repeat);
          return;
        case "KeyE":
          event.preventDefault();
          rotateSelection(-1, event.altKey, event.repeat);
          return;
        case "Delete":
        case "Backspace":
          event.preventDefault();
          if (!event.repeat) deleteSelection();
          return;
        case "Escape":
          cancel();
          return;
        case "Space":
          spaceRef.current = true;
          return;
        case "KeyV":
          setTool({ kind: "select" });
          return;
        case "KeyR":
          setTool({ kind: "room" });
          return;
        case "KeyD":
          setTool({ kind: "door" });
          return;
        case "KeyP":
          setTool({ kind: "spawn", team: "props" });
          return;
        case "KeyH":
          setTool({ kind: "spawn", team: "hunters" });
          return;
        case "KeyL":
          setTool({ kind: "light" });
          return;
        case "KeyC":
          setCeilingShown((shown) => !shown);
          return;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") spaceRef.current = false;
    };
    const onBlur = () => {
      spaceRef.current = false;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [cancel, deleteSelection, duplicateSelection, rotateSelection, save, stepHistory]);

  const worldAt = (event: { clientX: number; clientY: number }) => {
    const container = containerRef.current;
    return container
      ? groundAt(apiRef.current, container.getBoundingClientRect(), event.clientX, event.clientY)
      : null;
  };

  const pickAt = (current: LevelDocument, x: number, z: number): Selection => {
    const spawn = spawnAt(current, x, z, SPAWN_PICK_RADIUS);
    if (spawn) return { kind: "spawn", ...spawn };
    const objectId = objectAt(current, x, z, context, GHOST_RADIUS);
    if (objectId) return { kind: "object", id: objectId };
    const room = roomRectAt(current, x, z);
    return room ? { kind: "room", ...room } : null;
  };

  const place = (type: string, x: number, z: number, free: boolean) => {
    const def = catalogById.get(type);
    if (!def) return;
    const current = latest.current.history.present.doc;
    const result = placeObject(current, { type, relation: { at: { x, z } }, free }, context);
    if (!applyOp(result, `Add ${def.name}`)) return;
    const added = addedObjectId(current, result.doc);
    if (added) setSelection({ kind: "object", id: added });
  };

  const beginSelect = (current: LevelDocument, x: number, z: number) => {
    if (selection?.kind === "room") {
      const rect = current.rooms.find((room) => room.id === selection.roomId)?.rects[
        selection.index
      ];
      const { gx, gz } = toGrid(current, x, z);
      const edge = rect ? rectEdgeAt(rect, gx, gz, RESIZE_TOLERANCE) : null;
      if (rect && edge) {
        gestureRef.current = {
          kind: "resize",
          base: current,
          roomId: selection.roomId,
          index: selection.index,
          edge,
          rect,
        };
        return;
      }
    }
    const picked = pickAt(current, x, z);
    setSelection(picked);
    if (picked?.kind === "object") {
      const object = current.objects.find((candidate) => candidate.id === picked.id)!;
      gestureRef.current = {
        kind: "move-object",
        base: current,
        id: object.id,
        dx: object.x - x,
        dz: object.z - z,
        blocked: null,
      };
    } else if (picked?.kind === "spawn") {
      gestureRef.current = {
        kind: "move-spawn",
        base: current,
        team: picked.team,
        index: picked.index,
      };
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button === 1 || event.button === 2 || (event.button === 0 && spaceRef.current)) {
      if (view === "plan") {
        gestureRef.current = { kind: "pan", x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      return;
    }
    if (event.button !== 0) return;
    if (view === "orbit") {
      gestureRef.current = { kind: "click", x: event.clientX, y: event.clientY };
      return;
    }
    const at = worldAt(event);
    if (!at) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const current = history.present.doc;
    const free = event.altKey;
    setFocus(null);
    switch (tool.kind) {
      case "select":
        beginSelect(current, at.x, at.z);
        return;
      case "room": {
        const roomId = event.shiftKey && selection?.kind === "room" ? selection.roomId : null;
        gestureRef.current = {
          kind: "paint",
          base: current,
          start: cellAt(current, at.x, at.z),
          roomId,
          created: null,
        };
        paint(at);
        return;
      }
      case "door": {
        const door = edgeAt(current, at.x, at.z, EDGE_TOLERANCE);
        if (!door) return;
        const key = doorKey(door);
        const open = current.doors.some((existing) => doorKey(existing) === key);
        applyOp(toggleDoor(current, door), open ? "Close door" : "Open door");
        return;
      }
      case "spawn": {
        const result = addSpawn(
          current,
          tool.team,
          snapPosition(at.x, free),
          snapPosition(at.z, free),
        );
        commitLocal(result.doc, tool.team === "props" ? "Add prop spawn" : "Add hunter spawn");
        setSelection({ kind: "spawn", team: tool.team, index: result.index });
        return;
      }
      case "light": {
        const hit = lightAt(current, at.x, at.z, LIGHT_PICK_RADIUS);
        const light = hit === null ? undefined : current.lights?.find((entry) => entry.id === hit);
        if (light) {
          setSelection({ kind: "light", id: light.id });
          gestureRef.current = {
            kind: "move-light",
            base: current,
            id: light.id,
            dx: light.x - at.x,
            dz: light.z - at.z,
            blocked: null,
          };
          return;
        }
        const result = addLight(current, {
          at,
          kind: event.shiftKey ? "corridor" : "room",
          free,
        });
        if (!applyOp(result, "Add light")) return;
        const added = addedLightId(current, result.doc);
        if (added) setSelection({ kind: "light", id: added });
        return;
      }
      case "place":
        place(tool.type, at.x, at.z, free);
        if (!event.shiftKey) setTool({ kind: "select" });
        return;
    }
  };

  const paint = (at: { x: number; z: number }) => {
    const gesture = gestureRef.current;
    if (gesture?.kind !== "paint") return;
    const rect = rectBetween(gesture.base, gesture.start, cellAt(gesture.base, at.x, at.z));
    if (gesture.roomId) {
      const result = addRoomRect(gesture.base, gesture.roomId, rect);
      setPreview({ ...EMPTY_PREVIEW, rect: { rect, valid: !isRefusal(result) } });
      setDraft(isRefusal(result) ? null : result);
      return;
    }
    const created = newRoomId(gesture.base);
    const result = addRoom(gesture.base, { id: created, rect });
    setPreview({ ...EMPTY_PREVIEW, rect: { rect, valid: result.ok } });
    gesture.created = result.ok ? created : null;
    setDraft(result.ok ? result.doc : null);
  };

  const hover = (current: LevelDocument, at: { x: number; z: number }) => {
    if (tool.kind === "door") {
      const door = edgeAt(current, at.x, at.z, EDGE_TOLERANCE);
      setPreview({
        ...EMPTY_PREVIEW,
        edge: door ? { door, valid: toggleDoor(current, door).ok } : null,
      });
      setCursor(door ? "pointer" : "default");
      return;
    }
    if (tool.kind === "place") {
      setPreview({
        ...EMPTY_PREVIEW,
        ghost: {
          x: snapPosition(at.x, false),
          z: snapPosition(at.z, false),
          radius: radiusOf(tool.type),
        },
      });
      setCursor("copy");
      return;
    }
    if (tool.kind === "light") {
      const near = lightAt(current, at.x, at.z, LIGHT_PICK_RADIUS) !== null;
      setPreview({
        ...EMPTY_PREVIEW,
        ghost: near
          ? null
          : {
              x: snapPosition(at.x, false),
              z: snapPosition(at.z, false),
              radius: lightStyle?.reach ?? GHOST_RADIUS,
            },
      });
      setCursor(near ? "move" : "crosshair");
      return;
    }
    if (tool.kind === "room" || tool.kind === "spawn") {
      setCursor("crosshair");
      return;
    }
    if (selection?.kind === "room") {
      const rect = current.rooms.find((room) => room.id === selection.roomId)?.rects[
        selection.index
      ];
      const { gx, gz } = toGrid(current, at.x, at.z);
      const edge = rect ? rectEdgeAt(rect, gx, gz, RESIZE_TOLERANCE) : null;
      if (edge) {
        setCursor(edge.startsWith("i") ? "ew-resize" : "ns-resize");
        return;
      }
    }
    const picked = pickAt(current, at.x, at.z);
    setCursor(picked && picked.kind !== "room" ? "move" : "default");
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (gesture?.kind === "pan") {
      apiRef.current.panBy(event.clientX - gesture.x, event.clientY - gesture.y);
      gesture.x = event.clientX;
      gesture.y = event.clientY;
      return;
    }
    if (view === "orbit") return;
    const at = worldAt(event);
    if (!at) return;
    const free = event.altKey;
    switch (gesture?.kind) {
      case "move-object": {
        const result = fromOp(
          moveObject(
            gesture.base,
            { id: gesture.id, to: { x: at.x + gesture.dx, z: at.z + gesture.dz }, free },
            context,
          ),
        );
        if (isRefusal(result)) {
          gesture.blocked = result.refused;
          setNotice({ message: result.refused, tone: "info" });
          return;
        }
        gesture.blocked = null;
        setNotice(null);
        setDraft(result);
        return;
      }
      case "move-light": {
        const result = fromOp(
          moveLight(gesture.base, {
            id: gesture.id,
            to: { x: at.x + gesture.dx, z: at.z + gesture.dz },
            free,
          }),
        );
        if (isRefusal(result)) {
          gesture.blocked = result.refused;
          setNotice({ message: result.refused, tone: "info" });
          return;
        }
        gesture.blocked = null;
        setNotice(null);
        setDraft(result);
        return;
      }
      case "move-spawn":
        setDraft(
          moveSpawn(
            gesture.base,
            gesture.team,
            gesture.index,
            snapPosition(at.x, free),
            snapPosition(at.z, free),
          ),
        );
        return;
      case "resize": {
        const { gx, gz } = toGrid(gesture.base, at.x, at.z);
        const line = Math.round(gesture.edge.startsWith("i") ? gx : gz);
        const rect = moveRectEdge(gesture.rect, gesture.edge, line);
        const result = resizeRoom(gesture.base, { id: gesture.roomId, rect, index: gesture.index });
        setPreview({ ...EMPTY_PREVIEW, rect: { rect, valid: result.ok } });
        if (result.ok) setDraft(result.doc);
        return;
      }
      case "paint":
        paint(at);
        return;
      default:
        hover(history.present.doc, at);
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!gesture) {
      setPreview(EMPTY_PREVIEW);
      return;
    }
    if (gesture.kind === "click") {
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > CLICK_SLOP_PX) return;
      const at = worldAt(event);
      if (at) setSelection(pickAt(history.present.doc, at.x, at.z));
      return;
    }
    setPreview(EMPTY_PREVIEW);
    if ((gesture.kind === "move-object" || gesture.kind === "move-light") && gesture.blocked) {
      notify(`Move stopped short: ${gesture.blocked}`);
    }
    const draft = draftRef.current;
    if (!draft) return;
    setDraft(null);
    switch (gesture.kind) {
      case "move-object":
        commitLocal(draft, `Move ${gesture.id}`);
        return;
      case "move-light":
        commitLocal(draft, `Move ${gesture.id}`);
        return;
      case "move-spawn":
        commitLocal(draft, "Move spawn");
        return;
      case "resize":
        commitLocal(draft, `Resize ${gesture.roomId}`);
        return;
      case "paint":
        if (gesture.roomId) {
          const room = draft.rooms.find((candidate) => candidate.id === gesture.roomId)!;
          commitLocal(draft, `Extend ${gesture.roomId}`);
          setSelection({ kind: "room", roomId: gesture.roomId, index: room.rects.length - 1 });
        } else if (gesture.created) {
          commitLocal(draft, `Add ${gesture.created}`);
          setSelection({ kind: "room", roomId: gesture.created, index: 0 });
        }
        return;
    }
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (view !== "plan" || !container) return;
    apiRef.current.zoomAt(
      event.clientX,
      event.clientY,
      Math.exp(-event.deltaY * ZOOM_SENSITIVITY),
      container.getBoundingClientRect(),
    );
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(PALETTE_MIME)) return;
    event.preventDefault();
    const at = worldAt(event);
    setPreview({
      ...EMPTY_PREVIEW,
      ghost: at
        ? { x: snapPosition(at.x, false), z: snapPosition(at.z, false), radius: GHOST_RADIUS }
        : null,
    });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    const type = event.dataTransfer.getData(PALETTE_MIME);
    setPreview(EMPTY_PREVIEW);
    const at = worldAt(event);
    if (!type || !at) return;
    event.preventDefault();
    place(type, at.x, at.z, event.altKey);
  };

  const focusItem = (item: CheckItem) => {
    if (item.select !== undefined) setSelection(item.select);
    if (item.at) {
      setFocus(item.at);
      apiRef.current.centerOn(item.at.x, item.at.z);
    }
  };

  const recent = [...history.past.slice(-(RECENT_STEPS - 1)), history.present].reverse();

  return (
    <div className="editor">
      <div
        ref={containerRef}
        className="ed-stage"
        role="application"
        aria-label="Level plan"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          if (!gestureRef.current) setPreview(EMPTY_PREVIEW);
        }}
        onWheel={onWheel}
        onContextMenu={(event) => event.preventDefault()}
        onDragOver={onDragOver}
        onDragLeave={() => setPreview(EMPTY_PREVIEW)}
        onDrop={onDrop}
      >
        {map && (
          <EditorCanvas
            map={map}
            theme={theme}
            view={view}
            ceilingShown={ceilingShown}
            apiRef={apiRef}
            doc={doc}
            selection={selection}
            highlights={highlights}
            preview={preview}
            radiusOf={radiusOf}
            context={context}
            focus={focus}
            overlays={overlays}
            overlayToggles={overlayToggles}
            uniqueIds={uniqueIds}
            lightStyle={lightStyle}
            lightsTool={tool.kind === "light"}
          />
        )}
      </div>

      <div className="ed-top">
        <div className="ed-bar ed-bar-file">
          <span className="eyebrow">Map editor</span>
          <strong>{mapName}</strong>
          <span className={dirty ? "ed-dirty is-dirty" : "ed-dirty"}>
            {dirty ? "Unsaved" : "Saved"}
          </span>
          <button
            type="button"
            className="ed-btn"
            onClick={() => void save()}
            disabled={saving || !dirty}
          >
            Save <kbd>Ctrl S</kbd>
          </button>
          <button
            type="button"
            className="ed-btn is-accent"
            onClick={() => void tryIt()}
            disabled={saving}
          >
            Try it
          </button>
        </div>

        <div className="ed-bar ed-bar-tools">
          {TOOLS.map((entry) => (
            <button
              key={toolKey(entry.tool)}
              type="button"
              className={toolKey(tool) === toolKey(entry.tool) ? "ed-btn is-on" : "ed-btn"}
              onClick={() => setTool(entry.tool)}
            >
              {entry.label} <kbd>{entry.key}</kbd>
            </button>
          ))}
          <span className="ed-sep" />
          <button
            type="button"
            className="ed-btn"
            onClick={() => setView((current) => (current === "plan" ? "orbit" : "plan"))}
          >
            {view === "plan" ? "3D" : "Plan"} <kbd>Tab</kbd>
          </button>
          {view === "orbit" && (
            <button
              type="button"
              className={ceilingShown ? "ed-btn is-on" : "ed-btn"}
              onClick={() => setCeilingShown((shown) => !shown)}
            >
              Ceiling <kbd>C</kbd>
            </button>
          )}
          <button
            type="button"
            className="ed-btn"
            disabled={!canUndo(history)}
            title={canUndo(history) ? `Undo ${history.present.label}` : undefined}
            onClick={() => stepHistory(undo)}
          >
            Undo
          </button>
          <button
            type="button"
            className="ed-btn"
            disabled={!canRedo(history)}
            title={history.future[0] ? `Redo ${history.future[0].label}` : undefined}
            onClick={() => stepHistory(redo)}
          >
            Redo
          </button>
        </div>
      </div>
      <Palette
        catalog={catalog}
        armed={tool.kind === "place" ? tool.type : null}
        onArm={(type) => setTool(type ? { kind: "place", type } : { kind: "select" })}
      />

      <div className="ed-side">
        <Inspector
          doc={history.present.doc}
          selection={selection}
          catalog={catalogById}
          lightsTool={tool.kind === "light"}
          onChange={commitLocal}
          onPose={setObjectPose}
          onAgainstWall={placeAgainstWall}
          onLightPose={setLightPose}
          onProposeLights={proposeAllLights}
        />
        <ChecksPanel
          items={items}
          onFocus={focusItem}
          overlays={overlayToggles}
          onOverlays={setOverlayToggles}
        />
      </div>

      <div className="ed-panel ed-history">
        <div className="ed-panel-head">
          <span className="eyebrow">History</span>
        </div>
        <ul className="ed-list">
          {recent.map((entry, index) => (
            <li key={entry.seq} className={index === 0 ? "is-current" : undefined}>
              {entry.source === "external" && <span className="ed-badge">External</span>}
              {entry.label}
            </li>
          ))}
        </ul>
      </div>

      <div className={notice?.tone === "warning" ? "ed-hint is-warning" : "ed-hint"} role="status">
        {notice?.message ??
          "Drag props in from the palette. Q / E turn, Alt for free placement and rotation. Right-drag pans, wheel zooms."}
      </div>
    </div>
  );
}
