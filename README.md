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

## Usage

### Create a New Project

```bash
npm create hibana@latest <project-name>
```

### Install Dependencies

Move into the generated directory and install dependencies.

```bash
cd <project-name>
npm install
```

The generated `package.json` already includes `@hibana-apps/runtime`. To follow runtime updates after project creation, run `npm install @hibana-apps/runtime@latest` whenever needed.

### Start the Development Server

```bash
npx wrangler dev
```

---

## Code Samples

### Hello World

`app/app.rb`

```ruby
get "/" do |c|
  c.text("Hello from Ruby WASM")
end
```

### D1 Integration

`app/app.rb`

```ruby
get "/d1" do |c|
  db = c.env(:DB)
  result = db.prepare("SELECT * FROM posts WHERE id = ?").bind(1).first
  c.text(result)
end
```

### ORM (Experimental)

Define lightweight models with `Hibana::Record` to avoid hand-writing SQL for common CRUD cases.

`app/models/post.rb`

```ruby
class Post < Hibana::Record
  table_name "posts"
  primary_key :id
  timestamps true

  attribute :title, :string
  attribute :views, :integer, default: 0
  attribute :status, :string, default: "draft"

  belongs_to :user

  scope :published, -> { where(status: "published") }
end
```

`app/routes/posts.rb`

```ruby
get "/posts/popular" do |c|
  posts = Post
    .published
    .where("views >= ?", 1_000)
    .order(views: :desc)
    .limit(20)

  c.json(posts.map(&:as_json))
end
```

#### ORM CRUD Sample

`app/routes/posts.rb`

```ruby
get "/posts/crud-demo" do |c|
  created = Post.create!(
    user_id: 1,
    title: "CRUD demo from Hibana",
    status: "draft",
  )
  created_snapshot = created.as_json

  created.update(status: "published", views: created.views + 1)
  updated_snapshot = created.reload.as_json

  selected_snapshot = Post.find(created.id).as_json
  Post.destroy(created.id)

  c.json(
    create: created_snapshot,
    update: updated_snapshot,
    select: selected_snapshot,
    delete: { id: created.id },
  )
end
```

- The entire flow relies on `Hibana::Record`, so no manual SQL is necessary for create/update/select/delete.
- Swap the hard-coded `user_id`, `title`, and `status` values with request data when turning this into a production route.
- The row is deleted at the end, allowing you to hit the demo endpoint repeatedly without cluttering the table.

- Chains such as `select`, `where`, `order`, `limit`, `offset`, `count`, `exists?`, `pluck`, `create`, `update`, and `destroy` are supported.
- Associations (`belongs_to`, `has_many`) and scopes compose naturally, mirroring familiar ActiveRecord ergonomics.
- Each model talks to the default `:DB` binding; override `connection_name :ANOTHER_DB` when you need a different D1 database.
- The ORM stays thin—drop back down to `Post.connection.run(sql, binds)` or `HostBridge.run_d1_query` whenever you need full SQL control.

### KV Integration

`app/app.rb`

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

`app/app.rb`

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

### Durable Object Integration

Define your Durable Object class under `app/durable/` and register it with `Hibana::DurableObjects`.

`app/durable/counter.rb`

```ruby
class Counter < Hibana::DurableObject::Base
  def fetch(_request)
    current = storage.get("count").to_i
    storage.put("count", current + 1)
    json(count: current + 1)
  end
end

Hibana::DurableObjects.register :COUNTER, Counter
```

Expose a helper endpoint so regular routes can talk to the Durable Object namespace.

`app/app.rb`

```ruby
get "/durable/counter" do |c|
  result = c.env(:COUNTER)
    .fetch(name: "global")
    .json do
      post json: { action: "increment" }
    end

  c.json(result)
rescue Hibana::DurableObject::Error => e
  c.json({ error: e.message }, status: 500)
end
```

`wrangler.toml`

```toml
[durable_objects]
bindings = [{ name = "COUNTER", class_name = "Counter" }]

[[migrations]]
tag = "v1"
new_classes = ["Counter"]
```

Projects generated by the CLI include a `npm run build:durable` script that scans `app/durable/**/*.rb`, injects them into `setApplicationScripts`, and re-exports the generated `createDurableObjectClass` wrappers from `src/index.ts`. Running `npm run dev` or `npm run build` automatically regenerates this manifest, so committing the Ruby file + wrangler binding is all that’s required to add a new Durable Object.

### Workers AI Integration

You can also integrate with Workers AI. Each model expects different payload fields, so adjust the arguments accordingly.

Sample using `@cf/meta/llama-3.1-8b-instruct-fast`:

`app/app.rb`

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

`app/app.rb`

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

### Scheduled Cron Events

Configure Cloudflare Workers cron triggers in `wrangler.toml`, then register handlers in Ruby using the `cron` DSL. Wrangler still controls the actual schedule; Ruby only decides what to do when each cron fires.

`wrangler.toml`

```toml
[triggers]
crons = ["0 0 * * *", "0 12 * * *"]
```

`app/app.rb`

```ruby
cron "0 0 * * *" do |event, ctx|
  ctx.env(:KV).put("nightly_report", generate_report(event.scheduled_time))
end

cron "*" do |event, _ctx|
  puts "Received cron event: #{event.cron}"
end
```

- Handlers are evaluated in the order they are defined. All matching handlers run, so you can pair specific jobs with a final `cron "*"` fallback.
- Each handler receives the Cloudflare cron metadata (`event.cron`, `event.scheduled_time`, `event.retry_count`, etc.) and a `ScheduledContext`, which exposes the same `env(:KV)`, `json`, and other helpers available in HTTP routes.
- If Workers triggers execute a cron expression that has no Ruby handler, the runtime logs a warning every time that event fires to help you spot missing definitions.
- The default runtime export already exposes a `scheduled` entry point, so `export default runtime` wires cron events automatically. If you assemble handlers manually, call `runtimeScheduled(event, env, ctx)` yourself.

### Template Rendering

Add ERB files under `templates/` (the CLI scaffolds this directory). Layouts live under `templates/layouts/`.

```
templates/
  index.html.erb
  layouts/
    application.html.erb
```

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

`app/app.rb`

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

`app/app.rb`

```ruby
get "/legacy" do |c|
  c.redirect("/new-home")
end

get "/docs" do |c|
  c.redirect("/docs/latest", status: 301)
end
```

### HTTP Client

`app/app.rb`

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

`app/app.rb`

```ruby
get "/posts/:id" do |c|
  c.json(id: c.params[:id])
end
```

Use splats for catch-alls or regular expressions for advanced matching.

`app/app.rb`

```ruby
get "/assets/*path" do |c|
  c.text("Serving #{c.path_param(:path)}")
end

get %r{\A/users/(?<id>\d+)\z} do |c|
  c.text("User ##{c.params['id']}")
end
```

---

## CLI Options

| Option | Description | Default |
| --- | --- | --- |
| `--template <repo>` | Template repository (`user/repo`) | `hiroeorz/cloudflare_workers_ruby_template` |
| `--ref <ref>` | Template Git reference (tag / branch / commit) | `main` |
| `--force` | Overwrite the target directory if it already exists | `false` |
| `--wrangler-name <name>` | Override the `name` field in `wrangler.toml` | `<project-name>` |

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

### Build & Test

All commands run from the repository root. You can use npm scripts directly or call the equivalent Make targets.

| Task | npm | make |
| --- | --- | --- |
| Install dependencies | `npm run deps` | `make deps` |
| Build runtime + CLI | `npm run build:all` (alias: `npm run build`) | `make build` |
| Run all tests | `npm run test:all` (alias: `npm run test`) | `make test` |
| Clean build artifacts | `npm run clean` | `make clean` |
| Show package versions | `npm run versions` | `make versions` |

Workspace-specific commands still exist (for example `npm run build:runtime`, `npm run test:cli`, `npm run lint --workspace create-hibana`) when you only need one package.

### Local CLI + Runtime workflow

Use these helpers to try unpublished changes via `npm link`:

- `npm run install:local` (or `make install`)  
  Builds both packages, links `@hibana-apps/runtime` and `create-hibana` globally, and wires the CLI to the linked runtime. After this, the `create-hibana` command on your PATH will execute the local sources.
- `npm run uninstall:local` (or `make uninstall`)  
  Removes the global links and restores your environment.

To verify the runtime inside a generated project, install it from the workspace path inside that project:

```bash
npm install ../hibana/packages/runtime
```

This overrides the published package with your local build while you iterate. Run `npm install @hibana-apps/runtime@latest` in the project when you want to revert.

### Publishing to npm

`make publish` bundles the entire release flow:

```bash
make publish VERSION=0.2.0
```

This command:

1. Verifies the working tree is clean (skip with `ALLOW_DIRTY=1`).
2. Bumps versions via `scripts/bump-version.mjs` (both packages share `VERSION`; override with `CLI_VERSION` / `RUNTIME_VERSION` when needed).
3. Runs `npm run deps`, `npm run test:all`, and `npm run build:all`.
4. Publishes runtime then CLI using `npm publish --tag $(TAG)` (defaults to `latest`, override with `TAG=beta` etc.).

Ensure you’re logged in to npm with credentials that have access to the `hibana-apps` org before running the command.

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
