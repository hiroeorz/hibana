# Hibana 🧨

Hibana is a lightweight CLI that quickly fetches the Cloudflare Workers + Ruby template.
After generating a project you can write HTTP APIs with a familiar, Hono・Sinatra-style DSL.

Running `npm create hibana@latest <project-name>` clones the template, initializes configuration files, and prints the next steps. Day-to-day development, builds, and deployments rely on the Wrangler commands bundled with the template.

> This CLI is currently in alpha.

The shared runtime (Ruby/TypeScript bridge and Cloudflare client wrappers) lives in a separate package, `@hibana-apps/runtime`. Generated projects depend on it, and you can pick up updates later with `npm install @hibana-apps/runtime@latest`.

This CLI only scaffolds the Ruby project template that runs on Cloudflare Workers.
If you want to learn how Ruby executes on Workers in detail, see the template repository’s [template (hiroeorz
cloudflare_workers_ruby_template)](https://github.com/hiroeorz/cloudflare_workers_ruby_template/) `README.md` and the documents under `docs/`.

---

## Goals

- Provide a minimal template so Ruby code runs on Cloudflare Workers immediately.
- Deliver an interface that feels simple and natural for Ruby developers.

---

## Code Samples

### Hello World

```ruby
get "/" do |c|
  c.text("Hello from Ruby WASM")
end
```

### D1 Integration

```ruby
get "/d1" do |c|
  db = c.env(:DB)
  result = db.prepare("SELECT * FROM posts WHERE id = ?").bind(1).first
  c.text(result)
end
```

### KV Integration

```ruby
get "/kv" do |c|
  store = c.env(:MY_KV)
  key = "greeting"
  store.put(key, "Hello from KV!")
  value = store.get(key)
  c.text("Stored value: #{value}")
end
```

### R2 Integration

```ruby
get "/r2" do |c|
  key = "ruby-r2-key"
  value = "Hello from R2 sample!"

  bucket = c.env(:MY_R2)
  bucket.put(key, value) # save
  read_value = bucket.get(key).text # load

  c.text("Wrote '#{value}' to R2. Read back: '#{read_value}'")
end
```

### Workers AI Integration

You can also integrate with Workers AI. Each model expects different payload fields, so adjust the arguments accordingly.

Sample using `@cf/meta/llama-3.1-8b-instruct-fast`:

```ruby
get "/ai-demo-llama" do |c|
  ai = c.env(:AI)
  prompt = "What is Cloudflare Workers AI ?"
  model = "@cf/meta/llama-3.1-8b-instruct-fast"

  result = ai.run(
    model: model,
    payload: {
      prompt: prompt,
      temperature: 0.8,
      max_output_tokens: 30,
    },
  )
  c.json({ prompt: prompt, result: result })
rescue WorkersAI::Error => e
  c.json({ error: e.message, details: e.details }, status: 500)
end
```

Sample using `@cf/openai/gpt-oss-20b`:

```ruby
get "/ai-demo-gpt-oss" do |c|
  ai = c.env(:AI)
  prompt = "What is Cloudflare Workers AI ?"
  model = "@cf/openai/gpt-oss-20b"

  result = ai.run(
    model: model,
    payload: {
      input: prompt,
      reasoning: {
        effort: "low",
        summary: "auto",
      },
    },
  )
  c.json({ prompt: prompt, result: result })
rescue WorkersAI::Error => e
  c.json({ error: e.message, details: e.details }, status: 500)
end
```

### Template Rendering

Add ERB files under `templates/` (the CLI scaffolds this directory). Layouts live under `templates/layouts/`.

`templates/index.html.erb`

```erb
<h1>Hello <%= name %></h1>
<p>Age: <%= age %></p>
```

`templates/layouts/application.html.erb`

```erb
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Hibana</title>
  </head>
  <body>
    <%= yield %>
  </body>
</html>
```

`routes/app.rb`

```ruby
get "/" do |c|
  c.render("index", name: "Hiroe", age: 50)
end
```

Pass `layout: false` to skip layouts or `layout: "layouts/marketing"` to render a specific layout. You can also configure template paths upfront:

```ruby
Hibana.configure do |config|
  config.template_paths = ["templates", "templates/shared"]
end
```

### Redirects

```ruby
get "/legacy" do |c|
  c.redirect("/new-home")
end

get "/docs" do |c|
  c.redirect("/docs/latest", status: 301)
end
```

### HTTP Client

```ruby
get "/fetch-example" do |c|
  http = c.env(:HTTP)
  response = http.get("https://workers.dev/api/status",
    headers: { "accept" => "application/json" },
  )
  c.json(JSON.parse(response.body))
end
```

### Route Parameters

Use colon segments to capture parts of the path. Captured values land in `c.params` alongside the query string (path values win on key collisions). Access a single value via `c.path_param(:id)` if you prefer.

```ruby
get "/posts/:id" do |c|
  c.json(id: c.params[:id])
end
```

Use splats for catch-alls or regular expressions for advanced matching.

```ruby
get "/assets/*path" do |c|
  c.text("Serving #{c.path_param(:path)}")
end

get %r{\A/users/(?<id>\d+)\z} do |c|
  c.text("User ##{c.params['id']}")
end
```

---

## Usage

### Create a New Project

```bash
npm create hibana@latest <project-name>
```

### CLI Options

| Option | Description | Default |
| --- | --- | --- |
| `--template <repo>` | Template repository (`user/repo`) | `hiroeorz/cloudflare_workers_ruby_template` |
| `--ref <ref>` | Template Git reference (tag / branch / commit) | `main` |
| `--force` | Overwrite the target directory if it already exists | `false` |
| `--wrangler-name <name>` | Override the `name` field in `wrangler.toml` | `<project-name>` |

---

## Working with the Generated Template

Move into the generated directory and install dependencies.

```bash
cd <project-name>
npm install
```

The generated `package.json` already includes `@hibana-apps/runtime`. To follow runtime updates after project creation, run `npm install @hibana-apps/runtime@latest` whenever needed.

Start the development server:

```bash
npx wrangler dev
```

Open http://localhost:8787 to view the starter page.

Template-provided commands include:

- Launch dev server: `npx wrangler dev`
- Build: `npx wrangler build`
- Deploy to Cloudflare Workers: `npx wrangler deploy`
- D1 migrations: `npm run db:migrate`

Refer to the generated project’s `README.md` for further template details.

---

## Developer Guide

### Workspace Layout

```
packages/
  cli/              # CLI implementation (create-hibana)
    src/            # Commands and helpers
    tests/          # Vitest unit + E2E tests
  runtime/          # Shared runtime (@hibana-apps/runtime)
    src/            # TypeScript + Ruby bridge assets
    tests/          # Runtime-level unit tests
```

The repository uses npm workspaces. A single `npm install` at the root resolves dependencies for both packages.

### Common Scripts

```bash
# Install dependencies (root)
npm install

# CLI
npm run build --workspace create-hibana
npm run test  --workspace create-hibana
npm run lint  --workspace create-hibana
npm run typecheck --workspace create-hibana

# Runtime
npm run build --workspace @hibana-apps/runtime
npm run test  --workspace @hibana-apps/runtime
npm run typecheck --workspace @hibana-apps/runtime
```

Running `npm run build` at the workspace root invokes `build` for each package in order, so both CLI and runtime artifacts are refreshed together.

### Testing the CLI locally

1. Install dependencies and build both packages:
   ```bash
   npm install
   npm run build --workspace @hibana-apps/runtime
   npm run build --workspace create-hibana
   ```
2. Link the CLI globally:
   ```bash
   (cd packages/cli && npm link)
   ```
3. Execute `create-hibana <project-name>` anywhere to scaffold using your local changes.  
   When finished, run `npm unlink -g create-hibana` and `(cd packages/cli && npm unlink)` to remove the link.

### Local runtime + CLI workflow

Use these steps when you want to test unpublished changes end-to-end:

1. **Build the runtime (`@hibana-apps/runtime`)**
   - `cd ~/src/cloudflare/hibana && npm install`
   - `npm run build --workspace @hibana-apps/runtime`
2. **Build & link the CLI**
   - `npm run build --workspace create-hibana`
   - `(cd packages/cli && npm link)` (now `create-hibana` points to your local CLI)
3. **Point the template to the local runtime**
   - `cd <template-dir>`
   - `npm install`
   - `npm install ../hibana/packages/runtime`
4. **Scaffold a project with the linked CLI**
   - `create-hibana my-app --template hiroeorz/cloudflare_workers_ruby_template`
   - `cd my-app && npm install`
   - `npm install ../hibana/packages/runtime`
5. **Develop & verify**
   - `npm run build:generated`
   - `npx wrangler dev`
6. **Clean up**
   - `npm unlink -g create-hibana` and `(cd packages/cli && npm unlink)`
   - Restore the published runtime with `npm install @hibana-apps/runtime@latest`

### Publishing to npm

1. Publish the runtime:
   ```bash
   npm run build --workspace @hibana-apps/runtime
   cd packages/runtime
   npm publish --access public
   cd ../..
   ```
   > Ensure you’re logged in with npm credentials that have access to the `hibana-apps` org.

2. Publish the CLI:
   - Update `packages/cli/src/constants.ts` so `RUNTIME_PACKAGE_VERSION` matches the released runtime.
   - Bump `packages/cli/package.json`’s `version`.
   - Reinstall deps and run tests/build:
     ```bash
     npm install
     npm run test --workspace create-hibana
     npm run build --workspace create-hibana
     ```
   - Publish:
     ```bash
     cd packages/cli
     npm publish --access public
     cd ../..
     ```

---

## License

MIT License

---

## Q&A

- **How do I pick up template updates later?**  
  The CLI only clones during project creation. To apply updates, clone the template again or merge changes manually.

- **Can Wrangler commands be integrated into the CLI?**  
  Additional commands are future work. The initial release focuses on scaffolding only.

- **How do I target a different template repository?**  
  Use the `--template` and `--ref` options to point to any repository and reference you need.
