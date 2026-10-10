import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Use the existing tsx build toolchain; no additional browser bundler dependency.
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
export async function bundleMediaFixture(apiOrigin) {
  return build({
    entryPoints: [new URL("./entry.tsx", import.meta.url).pathname],
    bundle: true,
    write: false,
    outdir: "/fixture",
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: {
      "process.env.NODE_ENV": '"development"',
      "process.env.NEXT_PUBLIC_GEN_STORY_DEPLOY_TARGET": '"cloud"',
      "process.env.NEXT_PUBLIC_API_BASE_URL": JSON.stringify(apiOrigin),
    },
    plugins: [
      {
        name: "fixture-next-navigation",
        setup(build) {
          build.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({
            path: args.path,
            namespace: "fixture-next",
          }));
          build.onLoad({ filter: /.*/, namespace: "fixture-next" }, (args) => ({
            contents:
              args.path === "next/link"
                ? 'import React from "react";export default function Link(props){return React.createElement("a",props)}'
                : "export function usePathname(){return window.location.pathname}",
            loader: "js",
            resolveDir: new URL("../../", import.meta.url).pathname,
          }));
        },
      },
    ],
  });
}
