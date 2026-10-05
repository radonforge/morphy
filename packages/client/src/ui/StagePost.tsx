import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import { deviceHints } from "../game/deviceProbe";
import { type PostLook, postSettings, resolveTier, TIER_SETTINGS } from "../game/graphicsTier";
import { usePostFx } from "../game/postFx";
import { graphicsPreference } from "../game/prefs";

const STAGE_RENDER_PRIORITY = 1;

/**
 * Draws the stage through the match's post chain on the player's graphics tier, so the menu
 * shows the game as it will look; on Low, where there is no chain, the frame goes straight out.
 * Its own module so the stage can load it lazily: until it mounts, the canvas renders itself.
 */
export function StagePost({ look }: { look: PostLook }) {
  const tier = useMemo(() => TIER_SETTINGS[resolveTier(graphicsPreference(), deviceHints())], []);
  const post = useMemo(() => postSettings(tier, look), [tier, look]);
  const composer = usePostFx(post, tier.antialias);
  useFrame(({ gl, scene, camera }) => {
    if (composer) composer.render();
    else gl.render(scene, camera);
  }, STAGE_RENDER_PRIORITY);
  return null;
}
