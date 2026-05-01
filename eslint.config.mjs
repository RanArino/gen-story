import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const ignoredPaths = [
  "node_modules/**",
  "**/node_modules/**",
  ".next/**",
  "**/.next/**",
  "dist/**",
  "**/dist/**",
  "coverage/**",
  "**/coverage/**",
  "data/uploads/**",
];

export default [
  {
    ignores: ignoredPaths,
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
];
