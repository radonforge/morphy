import * as THREE from "three";

/** A rectangle of a kit's 512x512 colormap atlas, in pixels. */
interface AtlasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GlowRule {
  id: string;
  kit: string;
  models?: RegExp;
  rects: readonly AtlasRect[];
}

const ATLAS_CELL = 16;
const GLOW_INTENSITY = 0.7;

function column(col: number, fromRow: number, toRow: number): AtlasRect {
  return {
    x: col * ATLAS_CELL,
    y: fromRow * ATLAS_CELL,
    width: ATLAS_CELL,
    height: (toRow - fromRow + 1) * ATLAS_CELL,
  };
}

/**
 * Which atlas swatches glow, per kit. Kenney kits colour every face from one palette
 * atlas, so a mask on that atlas lights a swatch wherever it is used. The window
 * blues are used by nothing but buildings, so they glow kit-wide. The screen
 * yellows are shared with beds and crates, so they only glow on the screen models'
 * own materials. Measured by sampling the atlas at every model's UVs.
 */
const GLOW_RULES: readonly GlowRule[] = [
  { id: "windows", kit: "/models/urban/", rects: [column(23, 8, 15)] },
  { id: "holograms", kit: "/models/space/station/", rects: [column(23, 16, 23)] },
  {
    id: "screens",
    kit: "/models/space/station/",
    models: /\/(computer|display-wall)[^/]*\.glb$/,
    rects: [column(7, 16, 23)],
  },
];

const masks = new WeakMap<THREE.Texture["source"], Map<string, THREE.Texture>>();
const glowing = new WeakSet<THREE.Object3D>();

function maskFor(rule: GlowRule, map: THREE.Texture): THREE.Texture | null {
  const image = map.source.data as CanvasImageSource & { width?: number; height?: number };
  if (!image?.width || !image.height) return null;
  let byRule = masks.get(map.source);
  if (!byRule) {
    byRule = new Map();
    masks.set(map.source, byRule);
  }
  const cached = byRule.get(rule.id);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const r of rule.rects)
    context.drawImage(image, r.x, r.y, r.width, r.height, r.x, r.y, r.width, r.height);
  const mask = new THREE.CanvasTexture(canvas);
  mask.flipY = map.flipY;
  mask.colorSpace = map.colorSpace;
  mask.magFilter = map.magFilter;
  mask.minFilter = map.minFilter;
  byRule.set(rule.id, mask);
  return mask;
}

function glowMaterial(material: THREE.MeshStandardMaterial, mask: THREE.Texture): void {
  const map = material.map;
  if (!map) return;
  const emissiveMap = mask.clone();
  emissiveMap.offset.copy(map.offset);
  emissiveMap.repeat.copy(map.repeat);
  emissiveMap.rotation = map.rotation;
  emissiveMap.center.copy(map.center);
  emissiveMap.channel = map.channel;
  material.emissiveMap = emissiveMap;
  material.emissive.setRGB(1, 1, 1);
  material.emissiveIntensity = GLOW_INTENSITY;
  material.needsUpdate = true;
}

function combined(rules: readonly GlowRule[]): GlowRule {
  return {
    id: rules.map((rule) => rule.id).join("+"),
    kit: "",
    rects: rules.flatMap((rule) => rule.rects),
  };
}

/**
 * Light the screens and windows of a loaded model by giving its materials an
 * emissive mask cut from their own colormap. Runs on the cached model, so every
 * clone of it glows the same, a disguised player included. Idempotent per model.
 */
export function applyModelGlow(scene: THREE.Object3D, url: string): void {
  if (glowing.has(scene)) return;
  glowing.add(scene);
  const rules = GLOW_RULES.filter(
    (rule) => url.startsWith(rule.kit) && (!rule.models || rule.models.test(url)),
  );
  if (rules.length === 0) return;
  const rule = combined(rules);
  scene.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const standard = material as THREE.MeshStandardMaterial;
      if (!standard.isMeshStandardMaterial || !standard.map || standard.emissiveMap) continue;
      const mask = maskFor(rule, standard.map);
      if (mask) glowMaterial(standard, mask);
    }
  });
}
