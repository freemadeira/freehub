import { readFileSync } from "node:fs";
import path from "node:path";

import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

const noYjs = path.resolve(import.meta.dirname, "./src/lib/no-yjs.ts");

const { version } = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "./package.json"), "utf-8")
) as { version: string };

/** New on every build, so an open app can tell a newer one went live. */
const build = `${version}-${Date.now().toString(36)}`;

/** The build's id at /version.json, which open apps poll to update themselves. See src/lib/updates.ts. */
function buildVersion(): Plugin {
  return {
    generateBundle() {
      this.emitFile({
        fileName: "version.json",
        source: JSON.stringify({ build }),
        type: "asset",
      });
    },
    name: "build-version",
  };
}

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(build),
  },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    buildVersion(),
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
