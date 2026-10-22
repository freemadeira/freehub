import path from "node:path";

import type { UserConfig } from "vite";

const root = import.meta.dirname;

/**
 * The build of a service in the folder of that name: one file to run with
 * Node, with the app's code it uses bundled in.
 */
export function serviceConfig(name: string): UserConfig {
  const folder = path.resolve(root, name);
  return {
    build: {
      emptyOutDir: true,
      outDir: path.resolve(folder, "dist"),
      rollupOptions: {
        output: { entryFileNames: `${name}.js`, inlineDynamicImports: true },
      },
      ssr: path.resolve(folder, "main.ts"),
      target: "node24",
    },
    publicDir: false,
    resolve: { alias: { "@": path.resolve(root, "src") } },
    root,
    ssr: { noExternal: true, target: "node" },
  };
}
