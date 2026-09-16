import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { COLYSEUS_PROXY_PATH, DEFAULT_PORT, STATS_PATH } from "../shared/src/constants";
import { resolveBuildInfo } from "./buildInfo";
import { runtimeAssetsPlugin } from "./viteRuntimeAssets";

const buildInfo = resolveBuildInfo();

export default defineConfig({
  plugins: [react(), runtimeAssetsPlugin()],
  build: {
    rolldownOptions: {
      output: {
        advancedChunks: {
          /**
           * Both groups are required, in this order. Dropping the react group,
           * or listing it second, makes React land inside the three chunk
           * instead of its own: the entry point then has a static dependency on
           * that chunk, so the whole 3D stack returns to `modulepreload` and
           * loads before first paint again. Measured, not inferred — the three
           * chunk grows by exactly React's weight and reappears in index.html.
           * The regression fails no build and no test, so check index.html.
           */
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "three", test: /node_modules[\\/](three|@react-three)[\\/]/ },
          ],
        },
      },
    },
  },
  define: {
    __MORPHY_VERSION__: JSON.stringify(buildInfo.version),
    __MORPHY_BUILD__: JSON.stringify(buildInfo.build),
  },
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
