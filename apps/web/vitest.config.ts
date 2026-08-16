import { defineConfig } from "vitest/config";

export default defineConfig({
  // The app's tsconfig leaves JSX for Next to transform; component tests are
  // compiled here instead, so tell esbuild to use the automatic runtime.
  esbuild: { jsx: "automatic" },
  test: {
    exclude: ["e2e/**", "**/node_modules/**"],
  },
});
