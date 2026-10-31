import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  root: "src/ui",
  build: { outDir: "../../dist/ui", emptyOutDir: true },
  server: { port: 5198, strictPort: true },
});
