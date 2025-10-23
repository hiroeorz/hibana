# Hibana CLI

The Hibana CLI bootstraps edge-ready Ruby projects and orchestrates the WebAssembly toolchain.

## Development

```bash
npm install
npm run dev --workspace @hibana/cli -- --help
```

Use the `dev` script to run the TypeScript entry point with `tsx`. A production build emits JavaScript and types via `tsup`:

```bash
npm run build --workspace @hibana/cli
```

## Scaffolding Commands

- `hibana new <name>` creates a project skeleton (templates pending).
- `hibana dev` will wrap `wrangler dev` with Ruby WASM rebuild hooks.
- `hibana deploy` will bundle optimized artifacts and call `wrangler deploy`.
- `hibana db:schema:pull` and `hibana db:migrate` coordinate D1 schema syncing.

Each command currently prints a placeholder and will be wired to real workflows in follow-up iterations.
