export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Orthonormal axes of the sun's shadow camera, for a light shining from `sun` toward the origin. */
export interface SunBasis {
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function sunBasis(sun: Vec3): SunBasis {
  const forward = normalize({ x: -sun.x, y: -sun.y, z: -sun.z });
  const right = normalize(cross(forward, { x: 0, y: 1, z: 0 }));
  return { right, up: cross(right, forward), forward };
}

/**
 * Move `point` onto the shadow map's texel grid, measured in the light's own axes.
 *
 * A shadow camera that follows the player by arbitrary amounts resamples every
 * edge at a different sub-texel offset each frame, which reads as shimmering
 * along every shadow border. Snapping the centre to whole texels across the
 * light's view keeps each rasterised edge where it was; depth along the light is
 * left alone, since it does not move the image.
 */
export function snapToTexels(point: Vec3, basis: SunBasis, texel: number): Vec3 {
  const across = Math.round(dot(point, basis.right) / texel) * texel;
  const along = Math.round(dot(point, basis.up) / texel) * texel;
  const depth = dot(point, basis.forward);
  return {
    x: basis.right.x * across + basis.up.x * along + basis.forward.x * depth,
    y: basis.right.y * across + basis.up.y * along + basis.forward.y * depth,
    z: basis.right.z * across + basis.up.z * along + basis.forward.z * depth,
  };
}
