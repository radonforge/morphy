import { type LevelDocument, type LevelLight, SIDES, type Side } from "@morphy/level";
import type { PropDefinition } from "@morphy/shared";
import { useEffect, useState } from "react";
import { isRefusal, moveSpawn, setLightKind } from "./edits";
import type { Selection } from "./types";

const DEGREES = 180 / Math.PI;
const SHOWN_DECIMALS = 3;

function NumberField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const shown = String(Number(value.toFixed(SHOWN_DECIMALS)));
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const apply = () => {
    const parsed = Number(text);
    if (text.trim() === "" || !Number.isFinite(parsed)) {
      setText(shown);
      return;
    }
    if (parsed !== Number(shown)) onCommit(parsed);
  };
  return (
    <label className="ed-num">
      <span>{label}</span>
      <input
        className="ed-field"
        inputMode="decimal"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={apply}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setText(shown);
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

const LIGHT_KINDS: readonly LevelLight["kind"][] = ["room", "corridor"];

/** The Lights tool's panel: how many lights hang and the action that replaces them with the proposal. */
function LightsPanel({ count, onPropose }: { count: number; onPropose: () => void }) {
  return (
    <div className="ed-panel ed-inspector">
      <div className="ed-panel-head">
        <span className="eyebrow">Lights</span>
        <span className="ed-muted">{count}</span>
      </div>
      <p className="ed-muted">
        Click to add a room light, Shift-click for a corridor light, drag to move, Delete to remove.
        Alt places freely.
      </p>
      <div className="ed-wall-row">
        <button
          type="button"
          className="ed-btn"
          title="Replace every light with the layout's proposal"
          onClick={onPropose}
        >
          Propose lights
        </button>
      </div>
    </div>
  );
}

/**
 * Exact values of the selection, typed in: how an author sets an arbitrary angle
 * or position. Object and light changes go through `onPose`, `onAgainstWall` and
 * `onLightPose`, which run the level ops, so a typed value is refused for the same
 * reasons a drag is. With the Lights tool armed, its panel sits under the selection.
 */
export function Inspector({
  doc,
  selection,
  catalog,
  lightsTool,
  onChange,
  onPose,
  onAgainstWall,
  onLightPose,
  onProposeLights,
}: {
  doc: LevelDocument;
  selection: Selection;
  catalog: ReadonlyMap<string, PropDefinition>;
  lightsTool: boolean;
  onChange: (doc: LevelDocument, label: string) => void;
  onPose: (id: string, pose: { x?: number; z?: number; yawDegrees?: number }) => void;
  onAgainstWall: (id: string, side: Side) => void;
  onLightPose: (id: string, pose: { x?: number; z?: number }) => void;
  onProposeLights: () => void;
}) {
  return (
    <>
      <SelectionPanel
        doc={doc}
        selection={selection}
        catalog={catalog}
        onChange={onChange}
        onPose={onPose}
        onAgainstWall={onAgainstWall}
        onLightPose={onLightPose}
      />
      {lightsTool && <LightsPanel count={doc.lights?.length ?? 0} onPropose={onProposeLights} />}
    </>
  );
}

function SelectionPanel({
  doc,
  selection,
  catalog,
  onChange,
  onPose,
  onAgainstWall,
  onLightPose,
}: {
  doc: LevelDocument;
  selection: Selection;
  catalog: ReadonlyMap<string, PropDefinition>;
  onChange: (doc: LevelDocument, label: string) => void;
  onPose: (id: string, pose: { x?: number; z?: number; yawDegrees?: number }) => void;
  onAgainstWall: (id: string, side: Side) => void;
  onLightPose: (id: string, pose: { x?: number; z?: number }) => void;
}) {
  if (!selection) {
    return (
      <div className="ed-panel ed-inspector">
        <div className="ed-panel-head">
          <span className="eyebrow">Selection</span>
        </div>
        <p className="ed-muted">Nothing selected.</p>
      </div>
    );
  }
  if (selection.kind === "object") {
    const object = doc.objects.find((candidate) => candidate.id === selection.id);
    if (!object) return null;
    return (
      <div className="ed-panel ed-inspector">
        <div className="ed-panel-head">
          <span className="eyebrow">{catalog.get(object.type)?.name ?? object.type}</span>
          <span className="ed-muted">{object.id}</span>
        </div>
        <div className="ed-num-row">
          <NumberField label="x" value={object.x} onCommit={(x) => onPose(object.id, { x })} />
          <NumberField label="z" value={object.z} onCommit={(z) => onPose(object.id, { z })} />
          <NumberField
            label="yaw °"
            value={object.yaw * DEGREES}
            onCommit={(yawDegrees) => onPose(object.id, { yawDegrees })}
          />
        </div>
        <div className="ed-wall-row">
          <span className="ed-muted">Against wall</span>
          {SIDES.map((side) => (
            <button
              key={side}
              type="button"
              className="ed-btn"
              title={`Back onto the room's ${side} wall, facing in`}
              onClick={() => onAgainstWall(object.id, side)}
            >
              {side}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (selection.kind === "light") {
    const light = doc.lights?.find((candidate) => candidate.id === selection.id);
    if (!light) return null;
    return (
      <div className="ed-panel ed-inspector">
        <div className="ed-panel-head">
          <span className="eyebrow">{light.kind === "room" ? "Room light" : "Corridor light"}</span>
          <span className="ed-muted">{light.id}</span>
        </div>
        <div className="ed-num-row">
          <NumberField label="x" value={light.x} onCommit={(x) => onLightPose(light.id, { x })} />
          <NumberField label="z" value={light.z} onCommit={(z) => onLightPose(light.id, { z })} />
        </div>
        <div className="ed-wall-row">
          <span className="ed-muted">Kind</span>
          {LIGHT_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className={kind === light.kind ? "ed-btn is-on" : "ed-btn"}
              onClick={() => {
                const next = setLightKind(doc, light.id, kind);
                if (!isRefusal(next)) onChange(next, `Make ${light.id} a ${kind} light`);
              }}
            >
              {kind}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (selection.kind === "spawn") {
    const point = doc.spawns[selection.team][selection.index];
    if (!point) return null;
    const set = (x: number, z: number) =>
      onChange(moveSpawn(doc, selection.team, selection.index, x, z), "Move spawn");
    return (
      <div className="ed-panel ed-inspector">
        <div className="ed-panel-head">
          <span className="eyebrow">
            {selection.team === "props" ? "Prop spawn" : "Hunter spawn"}
          </span>
          <span className="ed-muted">#{selection.index + 1}</span>
        </div>
        <div className="ed-num-row">
          <NumberField label="x" value={point.x} onCommit={(x) => set(x, point.z)} />
          <NumberField label="z" value={point.z} onCommit={(z) => set(point.x, z)} />
        </div>
      </div>
    );
  }
  const room = doc.rooms.find((candidate) => candidate.id === selection.roomId);
  const rect = room?.rects[selection.index];
  if (!room || !rect) return null;
  return (
    <div className="ed-panel ed-inspector">
      <div className="ed-panel-head">
        <span className="eyebrow">Room</span>
        <span className="ed-muted">{room.id}</span>
      </div>
      <p className="ed-muted">
        Rect {selection.index + 1} of {room.rects.length}: {rect.i1 - rect.i0} x {rect.j1 - rect.j0}{" "}
        cells. Drag an edge to resize, Shift-drag with the Room tool to add a rect, Delete to remove
        it.
      </p>
    </div>
  );
}
