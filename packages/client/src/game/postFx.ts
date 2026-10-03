import { useThree } from "@react-three/fiber";
import { N8AOPostPass, type N8AOQualityMode } from "n8ao";
import {
  BlendFunction,
  BloomEffect,
  type Effect,
  EffectComposer,
  EffectPass,
  LookupTexture,
  LUT3DEffect,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from "postprocessing";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { type ColorGrade, gradeLutData } from "./colorGrade";
import type { BloomSettings, PostSettings } from "./graphicsTier";

const MSAA_SAMPLES = 4;
const BLOOM_SMOOTHING = 0.01;
const AO_QUALITY: N8AOQualityMode = "Medium";
const AO_RADIUS_M = 1;
const AO_DISTANCE_FALLOFF = 1;
const AO_INTENSITY = 2;
const LUT_SIZE = 32;
const VIGNETTE_OFFSET = 0.5;
const VIGNETTE_DARKNESS = 0.3;

/**
 * The curve a direct render gets from the renderer, which `@react-three/fiber`
 * sets to ACES Filmic. A composed frame skips the renderer's own tone mapping
 * (it only applies when drawing to the canvas), so the effect pass applies it.
 */
const TONE_MAPPING = ToneMappingMode.ACES_FILMIC;

/** Draws one frame of the scene through the post chain. */
export interface PostComposer {
  render(): void;
}

/**
 * The post chain for a map on a tier, or null to draw straight to the canvas. The
 * scene renders into a half-float buffer, multisampled when the tier antialiases so
 * the canvas's own MSAA is not lost; `N8AOPostPass` darkens it where geometry meets,
 * in linear light; one `EffectPass` then adds the bloom, tone maps, grades through
 * the map's lookup table, darkens the corners and converts to sRGB. A direct render
 * tone maps and converts itself, so with every effect at zero the two paths draw
 * the same image.
 */
export function usePostFx(post: PostSettings | null, antialias: boolean): PostComposer | null {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const dpr = useThree((state) => state.viewport.dpr);

  const chain = useMemo(() => {
    if (!post) return null;
    const lut = post.grade ? gradeLut(post.grade) : null;
    const composer = new EffectComposer(gl, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: antialias ? MSAA_SAMPLES : 0,
    });
    composer.addPass(new RenderPass(scene, camera));
    if (post.ao) composer.addPass(occlusionPass(scene, camera, post.ao.halfRes));
    const effects: Effect[] = [
      ...(post.bloom ? [bloomEffect(post.bloom)] : []),
      new ToneMappingEffect({ mode: TONE_MAPPING }),
      ...(lut ? [new LUT3DEffect(lut, { inputColorSpace: THREE.SRGBColorSpace })] : []),
      ...(post.vignette
        ? [new VignetteEffect({ offset: VIGNETTE_OFFSET, darkness: VIGNETTE_DARKNESS })]
        : []),
    ];
    composer.addPass(new EffectPass(camera, ...effects));
    return { composer, lut };
  }, [gl, scene, camera, post, antialias]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: dpr is a trigger, not read in the body; the composer sizes its buffers from the renderer's pixel ratio, which a dpr change resets.
  useEffect(() => {
    chain?.composer.setSize(size.width, size.height);
  }, [chain, size.width, size.height, dpr]);

  useEffect(
    () => () => {
      chain?.composer.dispose();
      chain?.lut?.dispose();
    },
    [chain],
  );

  return useMemo(() => {
    if (!chain) return null;
    return { render: () => chain.composer.render() };
  }, [chain]);
}

/**
 * Contact shadows in world units, so a crate darkens the floor the same at any
 * distance. Transparency awareness stays off: left on auto, n8ao scans the scene
 * every frame and draws every tracer, beam and pane of glass a second time.
 */
function occlusionPass(scene: THREE.Scene, camera: THREE.Camera, halfRes: boolean): N8AOPostPass {
  const pass = new N8AOPostPass(scene, camera);
  pass.setQualityMode(AO_QUALITY);
  pass.configuration.aoRadius = AO_RADIUS_M;
  pass.configuration.distanceFalloff = AO_DISTANCE_FALLOFF;
  pass.configuration.intensity = AO_INTENSITY;
  pass.configuration.halfRes = halfRes;
  pass.configuration.gammaCorrection = false;
  pass.configuration.transparencyAware = false;
  return pass;
}

/**
 * The map's grade baked into a 3D lookup table, sampled on the tone-mapped sRGB
 * frame. Half floats, because WebGL 2 filters them everywhere while 32-bit float
 * filtering is an extension many mobile GPUs lack. `LUT3DEffect` holds the table in
 * a uniform its own `dispose` never reaches, so the chain frees it.
 */
function gradeLut(grade: ColorGrade): LookupTexture {
  const texels = Uint16Array.from(gradeLutData(LUT_SIZE, grade), THREE.DataUtils.toHalfFloat);
  const lut = new LookupTexture(texels, LUT_SIZE);
  lut.type = THREE.HalfFloatType;
  return lut;
}

function bloomEffect(bloom: BloomSettings): BloomEffect {
  return new BloomEffect({
    blendFunction: BlendFunction.ADD,
    luminanceThreshold: bloom.threshold,
    luminanceSmoothing: BLOOM_SMOOTHING,
    intensity: bloom.intensity,
    radius: bloom.radius,
    mipmapBlur: true,
  });
}
