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
