/** The slice of `n8ao`'s API the post chain uses: the package ships JavaScript only. */
declare module "n8ao" {
  import type { Pass } from "postprocessing";
  import type { Camera, Color, Scene } from "three";

  export interface N8AOConfiguration {
    aoRadius: number;
    distanceFalloff: number;
    intensity: number;
    color: Color;
    gammaCorrection: boolean;
    halfRes: boolean;
  }

  export type N8AOQualityMode = "Performance" | "Low" | "Medium" | "High" | "Ultra";

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    readonly configuration: N8AOConfiguration;
    setQualityMode(mode: N8AOQualityMode): void;
  }
}
