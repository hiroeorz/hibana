import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  sourcemap: true,
  clean: true,
  format: ["esm"],
  target: "node18",
  dts: true,
  minify: false,
  shims: false,
  splitting: false,
  banner: {
    js: "#!/usr/bin/env node"
  }
});
