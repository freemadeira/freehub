import path from "node:path";

import { defineConfig } from "vite";

const root = path.resolve(import.meta.dirname, "..");

// One file to run with Node, with the app's own record format bundled in.
export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: path.resolve(import.meta.dirname, "dist"),
    rollupOptions: {
      output: { entryFileNames: "connector.js", inlineDynamicImports: true },
    },
    ssr: path.resolve(import.meta.dirname, "main.ts"),
    target: "node24",
  },
  publicDir: false,
  resolve: { alias: { "@": path.resolve(root, "src") } },
  root,
  ssr: { noExternal: true, target: "node" },
});
