import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { COLYSEUS_PROXY_PATH, DEFAULT_PORT, STATS_PATH } from "../shared/src/constants";
import { runtimeAssetsPlugin } from "./viteRuntimeAssets";

export default defineConfig({
  plugins: [react(), runtimeAssetsPlugin()],
  server: {
    host: true,
    allowedHosts: [".ngrok-free.dev"],
    proxy: {
      [COLYSEUS_PROXY_PATH]: {
        target: `http://localhost:${DEFAULT_PORT}`,
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.slice(COLYSEUS_PROXY_PATH.length),
      },
      [STATS_PATH]: {
        target: `http://localhost:${DEFAULT_PORT}`,
        changeOrigin: true,
      },
    },
    fs: {
      allow: ["../.."],
    },
  },
});
