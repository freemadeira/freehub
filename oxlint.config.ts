import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";

export default defineConfig({
  extends: [core, react],
  ignorePatterns: core.ignorePatterns,
  overrides: [
    {
      // Primitives receive their text and htmlFor through spread props.
      files: ["src/components/ui/**"],
      rules: {
        "jsx-a11y/heading-has-content": "off",
        "jsx-a11y/label-has-associated-control": "off",
      },
    },
    {
      // The map engine stays free of the app, so it can become a package.
      files: ["src/features/map/engine/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: [
                  "@/*",
                  "react",
                  "react-*",
                  "applesauce-*",
                  "wouter",
                  "rxjs",
                ],
                message:
                  "The map engine only uses three.js and its own modules; the React side passes it what it needs.",
              },
            ],
          },
        ],
      },
    },
  ],
  rules: {
    // Match the function declarations that the shadcn CLI generates.
    "func-style": ["error", "declaration", { allowArrowFunctions: true }],
    "react/function-component-definition": [
      "error",
      { namedComponents: "function-declaration" },
    ],
  },
});
