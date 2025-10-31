# Hibana CLI Design Notes

## Overview

The goal is to provide a simple CLI that scaffolds a Cloudflare Workers + Ruby project using the existing template repository:

```
git@github.com:hiroeorz/cloudflare_workers_ruby_template.git
```

The CLI will follow the “create-\*” convention, allowing developers to run:

```
npm create hibana@latest <project-name>
```

After the project is generated, users are expected to use the standard `npx wrangler` commands that are already documented within the template (dev server, build, deploy, D1 migrations, etc.). The CLI only handles project creation.

## Why a Separate CLI Project?

- **Responsibility separation**: The template repository stays focused on the Worker + Ruby codebase. The CLI is a thin wrapper for cloning / customizing the template.
- **Release management**: The template can evolve independently from the CLI. The CLI points to a specific tag or branch when cloning so updates remain predictable.
- **Distribution**: The CLI package stays small if it simply downloads the template instead of bundling all files.

## CLI Responsibilities

- Fetch the template from `git@github.com:hiroeorz/cloudflare_workers_ruby_template.git`, ideally via `degit`, `git clone`, or similar.
- Copy the template into a new directory named after the user’s project (`<project-name>`), adjusting configuration values such as:
  - `package.json` `name`
  - `wrangler.toml` `name` (optional) and default bindings if desired
- Provide basic prompts or flags for optional features (future work).
- Print next steps (e.g., `cd <project-name>`, `npm install`, `npm run dev`, `npm run db:migrate`).
- Defer to Wrangler for all operations after scaffolding.

## Non-goals for the Initial Version

- Running Wrangler commands (dev, deploy, migrations) from the CLI.
- Managing template updates after project creation.
- Advanced customization of template content beyond simple search/replace.

The CLI should stay focused on the initial scaffolding experience, similar to `npm create hono@latest`.

## Future Enhancements (Optional)

- Provide additional flags or interactive prompts to toggle features (e.g., include/exclude D1).
- Offer a template selection mechanism if multiple variants are published later.
- Add an `update` command to apply patches from the template repository when desired.
- Integrate simple environment checks (`wrangler`, Node.js version) before scaffolding.

## Summary

1. **Template repository**: keep `cloudflare_workers_ruby_template` as the source of truth for the Worker + Ruby project.
2. **CLI package**: publish a separate `create-hibana` npm package that clones the template.
3. **Usage**: developers run `npm create hibana@latest <project-name>`, then follow the documented `wrangler` workflows inside the generated project.
4. This approach mirrors Hono’s setup: minimal CLI, rely on official tooling (Wrangler) for runtime tasks.
