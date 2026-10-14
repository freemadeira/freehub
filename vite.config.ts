import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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

/** The emoji picker's data, from the `emojibase-data` package. See src/components/emoji-picker.tsx. */
const EMOJI_FILES = ["en/data.json", "en/messages.json"];

/**
 * Serves the emoji picker's data at /emojibase, in development and in the
 * build, so it never asks a CDN and opens offline once it has loaded.
 */
function emojiData(): Plugin {
  const root = path.dirname(
    createRequire(import.meta.url).resolve("emojibase-data/package.json")
  );
  const read = (file: string) => readFileSync(path.join(root, file));
  return {
    configureServer(server) {
      server.middlewares.use("/emojibase", (request, response, next) => {
        const file = EMOJI_FILES.find((name) => request.url === `/${name}`);
        if (!file) {
          next();
          return;
        }
        response.setHeader("Content-Type", "application/json");
        response.end(read(file));
      });
    },
    generateBundle() {
      for (const file of EMOJI_FILES) {
        this.emitFile({
          fileName: `emojibase/${file}`,
          source: read(file),
          type: "asset",
        });
      }
    },
    name: "emoji-data",
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
    emojiData(),
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
