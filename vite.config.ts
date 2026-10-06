import path from "node:path";

import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const noYjs = path.resolve(import.meta.dirname, "./src/lib/no-yjs.ts");

export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // The drag handle's Yjs support, which the app doesn't use. See the file.
      "@tiptap/extension-collaboration": noYjs,
      "@tiptap/y-tiptap": noYjs,
    },
  },
});
