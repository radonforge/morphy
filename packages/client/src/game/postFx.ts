import { useThree } from "@react-three/fiber";
import {
  BlendFunction,
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
} from "postprocessing";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { BloomSettings } from "./graphicsTier";

const MSAA_SAMPLES = 4;
const BLOOM_SMOOTHING = 0.01;

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
 * The post chain for a theme that asks for one, or null to draw straight to the
 * canvas. The scene renders into a half-float buffer, multisampled when the tier
 * antialiases so the canvas's own MSAA is not lost, and one `EffectPass` adds the
 * bloom, tone maps and converts to sRGB, which a direct render does itself: with
 * the bloom at zero the two paths draw the same image.
 */
export function usePostFx(bloom: BloomSettings | null, antialias: boolean): PostComposer | null {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const dpr = useThree((state) => state.viewport.dpr);

  const composer = useMemo(() => {
    if (!bloom) return null;
    const chain = new EffectComposer(gl, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: antialias ? MSAA_SAMPLES : 0,
    });
    chain.addPass(new RenderPass(scene, camera));
    chain.addPass(
      new EffectPass(
        camera,
        new BloomEffect({
          blendFunction: BlendFunction.ADD,
          luminanceThreshold: bloom.threshold,
          luminanceSmoothing: BLOOM_SMOOTHING,
          intensity: bloom.intensity,
          radius: bloom.radius,
          mipmapBlur: true,
        }),
        new ToneMappingEffect({ mode: TONE_MAPPING }),
      ),
    );
    return chain;
  }, [gl, scene, camera, bloom, antialias]);

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
