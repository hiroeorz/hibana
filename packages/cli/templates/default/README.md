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

The WASM build step copies the official `@ruby/3.4-wasm-wasi` runtime into `dist/wasm/app.wasm` and archives your Ruby sources. Set `HIBANA_WASM_BUILD="<command>"` to override the compiler pipeline. The Worker imports `dist/wasm/app.wasm` directly, so keep the path stable or update `src/index.ts` accordingly.

## Scripts

- `npm run dev` — start the Hibana development loop. When Ruby files change, `bundle exec rake wasm:build` runs automatically.
- `npm run deploy` — run `bundle exec rake wasm:build`, `npm run build`, then deploy via `hibana deploy` (use `--skip-ruby-build` / `--skip-assets-build` as needed).
- `npm run test` — run the project's test suites (fill in once tests exist).

## Runtime Notes

- `require 'hibana'` loads the routing DSL; `get`, `post`, and friends register handlers on `Hibana.app`.
- `Hibana::ENTRYPOINT = Hibana.app` exposes the router to the WASM runtime. You can still replace it with any Rack-compatible object if needed.
- Each request is transformed into a Rack env hash inside `Hibana::Runtime` (embedded by the Worker shim) and dispatched to `Hibana::ENTRYPOINT`.
- The `Context` object (`|c|`) gives access to `c.param`, `c.query`, `c.req.json`, `c.text`, `c.json`, and `c.status`.
- Update `Hibana::Runtime` logic in `src/index.ts` if your application needs custom request/response shaping.

Happy hacking!
