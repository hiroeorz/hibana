import { defineConfig } from "tsup"

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/ruby-runtime.ts",
    "src/polyfills.ts",
    "src/helper-registry.ts",
    "src/script-registry.ts",
    "src/http-fetch-utils.ts",
  ],
  sourcemap: true,
  clean: true,
  format: ["esm"],
  target: "es2021",
  dts: true,
  minify: false,
  shims: false,
  splitting: false,
  loader: {
    ".rb": "text",
  },
  onSuccess: "node ./scripts/copy-ruby-assets.mjs",
})
