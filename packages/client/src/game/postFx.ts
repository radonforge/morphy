import { useThree } from "@react-three/fiber";
import { N8AOPostPass, type N8AOQualityMode } from "n8ao";
import {
  BlendFunction,
  BloomEffect,
  type Effect,
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
} from "postprocessing";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { BloomSettings, PostSettings } from "./graphicsTier";

const MSAA_SAMPLES = 4;
const BLOOM_SMOOTHING = 0.01;
const AO_QUALITY: N8AOQualityMode = "Medium";
const AO_RADIUS_M = 1;
const AO_DISTANCE_FALLOFF = 1;
const AO_INTENSITY = 2;

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
 * in linear light; one `EffectPass` then adds the bloom, tone maps and converts to
 * sRGB, which a direct render does itself, so with every effect at zero the two
 * paths draw the same image.
 */
export function usePostFx(post: PostSettings | null, antialias: boolean): PostComposer | null {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const dpr = useThree((state) => state.viewport.dpr);

  const composer = useMemo(() => {
    if (!post) return null;
    const chain = new EffectComposer(gl, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: antialias ? MSAA_SAMPLES : 0,
    });
    chain.addPass(new RenderPass(scene, camera));
    if (post.ao) chain.addPass(occlusionPass(scene, camera, post.ao.halfRes));
    const effects: Effect[] = post.bloom ? [bloomEffect(post.bloom)] : [];
    chain.addPass(
      new EffectPass(camera, ...effects, new ToneMappingEffect({ mode: TONE_MAPPING })),
    );
    return chain;
  }, [gl, scene, camera, post, antialias]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: dpr is a trigger, not read in the body; the composer sizes its buffers from the renderer's pixel ratio, which a dpr change resets.
  useEffect(() => {
    composer?.setSize(size.width, size.height);
  }, [composer, size.width, size.height, dpr]);

  useEffect(() => () => composer?.dispose(), [composer]);

  return useMemo(() => {
    if (!composer) return null;
    return { render: () => composer.render() };
  }, [composer]);
}

/** Contact shadows in world units, so a crate darkens the floor the same at any distance. */
function occlusionPass(scene: THREE.Scene, camera: THREE.Camera, halfRes: boolean): N8AOPostPass {
  const pass = new N8AOPostPass(scene, camera);
  pass.setQualityMode(AO_QUALITY);
  pass.configuration.aoRadius = AO_RADIUS_M;
  pass.configuration.distanceFalloff = AO_DISTANCE_FALLOFF;
  pass.configuration.intensity = AO_INTENSITY;
  pass.configuration.halfRes = halfRes;
  pass.configuration.gammaCorrection = false;
  return pass;
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
