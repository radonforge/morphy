import { type RefObject, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { deviceHints } from "../game/deviceProbe";
import { type PostLook, postSettings, resolveTier, TIER_SETTINGS } from "../game/graphicsTier";
import { type PostComposer, usePostFx } from "../game/postFx";
import { graphicsPreference, subscribeGraphicsPreference } from "../game/prefs";

/**
 * Builds the match's post chain on the player's graphics tier for the world it is mounted in, so
 * the menu shows the game as it will look, and hands it to the stage through `target`: the stage
 * draws the open world itself, inside its slice, and only borrows the chain to do it. On Low,
 * where there is no chain, `target` stays empty and the stage draws straight to the canvas. Its
 * own module so the stage can load it lazily: until it mounts, the stage draws without it.
 * The chain is handed over in the commit that mounts it, so a world opening never draws a frame
 * between losing the old world's chain and getting its own. Picking another graphics quality in
 * Options rebuilds the chain on the new tier at once, which is the stage's live preview of it.
 */
export function StagePost({
  look,
  target,
}: {
  look: PostLook;
  target: RefObject<PostComposer | null>;
}) {
  const preference = useSyncExternalStore(subscribeGraphicsPreference, graphicsPreference);
  const tier = useMemo(() => TIER_SETTINGS[resolveTier(preference, deviceHints())], [preference]);
  const post = useMemo(() => postSettings(tier, look), [tier, look]);
  const composer = usePostFx(post, tier.antialias);
  useLayoutEffect(() => {
    target.current = composer;
    return () => {
      if (target.current === composer) target.current = null;
    };
  }, [target, composer]);
  return null;
}
