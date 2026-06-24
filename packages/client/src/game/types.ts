export interface RemotePlayerView {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  rot: number;
}

export type PlayersRef = { readonly current: Map<string, RemotePlayerView> };
