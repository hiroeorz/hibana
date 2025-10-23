# Hibana (alpha)

## Overview
Hibana is an experimental Ruby framework tailored for Cloudflare Workers. It leverages Ruby 3.4’s WASM/WASI support to deliver a lightweight, Rack-inspired experience at the edge. The project aims to blend the minimalism of Sinatra with modern routing ideas from Hono, while providing effortless tooling (`hibana` CLI) to scaffold, iterate, and deploy Ruby code that executes inside a WebAssembly module.

## Quick Start
The repository currently contains a monorepo with a work-in-progress CLI and sample templates. To try the stack locally:

```bash
# install Node.js dependencies (Node >= 22 recommended)
npm install

# build the CLI workspace
npm run build --workspace @hibana/cli

# create a sample project (generates my-app/)
node packages/cli/bin/hibana.js new my-app
cd my-app

# install project deps
npm install
bundle install  # requires Ruby 3.4.7 with Bundler

# run the development loop (wrangler dev + Ruby WASM auto rebuilds)
npm run dev
```

The generated Worker imports `dist/wasm/app.wasm`, boots the Ruby VM via `@ruby/wasm-wasi`, and forwards requests to the Rack-style endpoint defined in `app/app.rb` (`Hibana::ENTRYPOINT`). The default template returns `Hello from Hibana Ruby!`.

## Requirements & Notes
- Ruby 3.4.7 (preview) with WASM/WASI support, plus Bundler.
- Node.js 22+ and npm.
- Cloudflare Wrangler v4 (`devDependencies` in the template pin the minimum version).
- The CLI builds a manifest (`dist/wasm/manifest.{json,js}`) containing embedded Ruby sources. Workers load this manifest dynamically to hydrate the Ruby VM.
- `HIBANA_WASM_BUILD` can point to a custom build command to replace the bundled runtime with a compiled artifact.

## Current Status
- `hibana new`, `hibana dev`, and `hibana deploy` are wired, but the runtime bridge is still a prototype; request handling is limited to plain text responses.
- Database/D1 tooling (`db:schema:pull`, `db:migrate`) are placeholders awaiting integration with the JSON plan adapter described in `idea.md`.
- Tests cover template scaffolding; end-to-end Worker tests remain to be added.

## Roadmap Highlights
1. Finalize the Hibana routing DSL and Ruby-side runtime bridge.
2. Implement Cloudflare binding adapters (D1/KV/R2) using the JSON plan pattern.
3. Harden deployment (asset bundling, size optimizations) and document multi-environment workflows.
4. Add CI, release automation, and publishable npm packages when the CLI stabilizes.

Contributions, feedback, and edge-case reports are welcome while the project matures.***
