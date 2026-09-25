import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

interface TextureReference {
  textures?: number;
}

/** The part of a loaded glTF this module reads: `useGLTF`'s result satisfies it structurally. */
interface LoadedModel {
  scene: THREE.Object3D;
  parser: {
    json: unknown;
    options: { path?: string };
    associations: { get(key: THREE.Texture): TextureReference | undefined };
  };
}

interface ImageIndex {
  textures: ReadonlyArray<{ source?: unknown }>;
  images: ReadonlyArray<{ uri?: unknown }>;
}

const canonicalSources = new Map<string, THREE.Texture["source"]>();
const shared = new WeakSet<LoadedModel>();

function imageIndex(json: unknown): ImageIndex | null {
  if (typeof json !== "object" || json === null) return null;
  const { textures, images } = json as { textures?: unknown; images?: unknown };
  if (!Array.isArray(textures) || !Array.isArray(images)) return null;
  return { textures, images };
}

function imageUrl(model: LoadedModel, index: ImageIndex, texture: THREE.Texture): string | null {
  const textureIndex = model.parser.associations.get(texture)?.textures;
  if (textureIndex === undefined) return null;
  const source = index.textures[textureIndex]?.source;
  if (typeof source !== "number") return null;
  const uri = index.images[source]?.uri;
  if (typeof uri !== "string") return null;
  return THREE.LoaderUtils.resolveURL(uri, model.parser.options.path ?? "");
}

function texturesOf(material: THREE.Material): THREE.Texture[] {
  const found: THREE.Texture[] = [];
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) found.push(value);
  }
  return found;
}

/**
 * Point every texture of a loaded model at one shared image source per file URL.
 *
 * Each Kenney GLB references its kit's `Textures/colormap.png`, and the glTF loader
 * decodes and uploads that image once per GLB, so a map uploaded the same 512x512
 * colormap two dozen times. Sharing the `Source` rather than the `Texture` is what
 * keeps this safe: every material carries its own `KHR_texture_transform`, and the
 * transform lives on the `Texture`. Idempotent per model, so callers can run it on
 * every render.
 */
function shareKitTextures(model: LoadedModel): void {
  if (shared.has(model)) return;
  shared.add(model);
  const index = imageIndex(model.parser.json);
  if (!index) return;
  model.scene.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      for (const texture of texturesOf(material)) {
        const url = imageUrl(model, index, texture);
        if (!url) continue;
        const canonical = canonicalSources.get(url);
        if (!canonical) canonicalSources.set(url, texture.source);
        else if (texture.source !== canonical) texture.source = canonical;
      }
    }
  });
}

/**
 * `useGLTF` for every renderable model: the cached result, with its kit textures shared.
 *
 * The sharing runs during render on purpose. It is idempotent per model and correct
 * whether or not the render commits, and it has to land before the first frame
 * uploads the model's textures, which an effect would run too late for.
 */
export function useSharedGLTF(url: string): ReturnType<typeof useGLTF<string>> {
  const model = useGLTF(url);
  shareKitTextures(model);
  return model;
}
