import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  root: "src/ui",
  build: { outDir: "../../dist/ui", emptyOutDir: true },
  server: { host: process.env.TAURI_DEV_HOST || "127.0.0.1", port: 5198, strictPort: true },
});
