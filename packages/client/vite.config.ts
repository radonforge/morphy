import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { COLYSEUS_PROXY_PATH, DEFAULT_PORT } from "../shared/src/constants";

export default defineConfig({
  plugins: [react()],
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
    },
    fs: {
      allow: ["../.."],
    },
  },
});
