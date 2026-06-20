// Bundle the worker (tick: nightly Dreaming + cache prune) into a single self-contained
// ESM file the Vercel Cron function (api/cron/dream.ts) imports — @vercel/node ships
// functions unbundled, so the worker must be pre-built like dist/server is. The banner
// polyfills require/__dirname/__filename so inlined CommonJS deps that do `require("fs")`
// work under ESM ("Dynamic require not supported" otherwise).
import { build } from "esbuild";

await build({
  entryPoints: ["src/server/worker.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "dist/worker/index.mjs",
  // The worker now reaches the @xenova PII anonymiser (via chatPrivate), which loads native
  // onnxruntime / sharp .node binaries esbuild can't bundle. Externalise them — they resolve from
  // node_modules at runtime, the same way the vite SSR build (which also uses @xenova) treats them.
  external: ["@xenova/transformers", "onnxruntime-node", "sharp"],
  banner: {
    js: [
      "import { createRequire as __cr } from 'module';",
      "import { fileURLToPath as __furl } from 'url';",
      "import { dirname as __dir } from 'path';",
      "const require = __cr(import.meta.url);",
      "const __filename = __furl(import.meta.url);",
      "const __dirname = __dir(__filename);",
    ].join(""),
  },
});

console.log("built dist/worker/index.mjs");
