export type Phase = "lobby" | "starting" | "hiding" | "hunting" | "round_end";

export type Role = "hunter" | "prop";

export const MSG_INPUT = "input";
export const MSG_TRANSFORM = "transform";

export interface InputMessage {
  x: number;
  y: number;
  z: number;
  rot: number;
}

export interface TransformMessage {
  propType: string;
}
