import type { PropDefinition } from "@morphy/shared";

/**
 * A morphable prop whose hitbox is a single upright box (`width`×`height`×`width`);
 * the GLB at `/models/<kit>/<id>.glb` is fitted to that box client-side. Shared by
 * every prop catalog so the box/model shape lives in one place.
 */
export function boxProp(
  kit: string,
  id: string,
  name: string,
  width: number,
  height: number,
  color: string,
): PropDefinition {
  return {
    id,
    name,
    model: `/models/${kit}/${id}.glb`,
    parts: [
      {
        kind: "box",
        position: { x: 0, y: height / 2, z: 0 },
        size: { x: width, y: height, z: width },
        color,
      },
    ],
  };
}
