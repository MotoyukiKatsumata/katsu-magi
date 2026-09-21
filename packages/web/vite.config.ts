import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const SERVER = "127.0.0.1:5175";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/ws": { target: `ws://${SERVER}`, ws: true },
      "/api": { target: `http://${SERVER}` },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
