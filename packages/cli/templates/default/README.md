# {{projectName}}

This project was generated with the Hibana CLI.

## Getting Started

```bash
npm install
bundle install
bundle exec rake wasm:build
npm run dev
```

> If you copy this project outside the Hibana monorepo, update `package.json` so `@hibana/cli` points to a published version or global install.

The WASM build step copies the official `@ruby/3.4-wasm-wasi` runtime into `dist/wasm/app.wasm` and archives your Ruby sources. Set `HIBANA_WASM_BUILD="<command>"` to override the compiler pipeline.

## Scripts

- `npm run dev` — start the Hibana development loop. When Ruby files change, `bundle exec rake wasm:build` runs automatically.
- `npm run deploy` — deploy the Worker with optimized Ruby WASM assets.
- `npm run test` — run the project's test suites (fill in once tests exist).

Happy hacking!
