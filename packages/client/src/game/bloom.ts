import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { BloomSettings } from "./graphicsTier";

const MSAA_SAMPLES = 4;

/** Draws one frame of the scene through the bloom chain. */
export interface BloomComposer {
  render(scene: THREE.Scene, camera: THREE.Camera): void;
}

/**
 * The bloom chain for a theme that asks for one, or null to draw straight to the
 * canvas. The scene renders into a half-float, multisampled target so the canvas's
 * own antialiasing is not lost, bright pixels bleed through `UnrealBloomPass`, and
 * `OutputPass` applies the renderer's tone mapping and sRGB conversion last, which a
 * direct render does itself: with bloom at zero the two paths draw the same image.
 */
export function useBloomComposer(
  settings: BloomSettings | null,
  antialias: boolean,
): BloomComposer | null {
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const dpr = useThree((state) => state.viewport.dpr);

  const chain = useMemo(() => {
    if (!settings) return null;
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: antialias ? MSAA_SAMPLES : 0,
    });
    const composer = new EffectComposer(gl, target);
    const scenePass = new RenderPass(new THREE.Scene(), new THREE.Camera());
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      settings.strength,
      settings.radius,
      settings.threshold,
    );
    composer.addPass(scenePass);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    return { composer, scenePass, bloomPass };
  }, [gl, settings, antialias]);

  useEffect(() => {
    if (!chain) return;
    chain.composer.setPixelRatio(dpr);
    chain.composer.setSize(size.width, size.height);
  }, [chain, size.width, size.height, dpr]);

  useEffect(
    () => () => {
      chain?.bloomPass.dispose();
      chain?.composer.dispose();
    },
    [chain],
  );

  return useMemo(() => {
    if (!chain) return null;
    return {
      render(scene: THREE.Scene, camera: THREE.Camera) {
        chain.scenePass.scene = scene;
        chain.scenePass.camera = camera;
        chain.composer.render();
      },
    };
  }, [chain]);
}
