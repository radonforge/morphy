export type Phase = "lobby" | "starting" | "hiding" | "hunting" | "round_end";

export const MSG_INPUT = "input";

export interface InputMessage {
  x: number;
  y: number;
  z: number;
  rot: number;
}
