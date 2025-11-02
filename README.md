# Hibana 🧨

Hibana is a lightweight CLI that quickly fetches the Cloudflare Workers + Ruby template.
After generating a project you can write HTTP APIs with a familiar, Hono・Sinatra-style DSL.

Running `npm create hibana@latest <project-name>` clones the template, initializes configuration files, and prints the next steps. Day-to-day development, builds, and deployments rely on the Wrangler commands bundled with the template.

> This CLI is currently in alpha.

This CLI only scaffolds the Ruby project template that runs on Cloudflare Workers.
If you want to learn how Ruby executes on Workers in detail, see the template repository’s [`README.md`](https://github.com/hiroeorz/cloudflare_workers_ruby_template/) and the documents under `docs/`.

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

### Repository Layout

```
src/
  config-editor.ts  # Updates configuration files after extraction
  constants.ts      # Default values related to the template
  errors.ts         # Custom errors used by the CLI
  index.ts          # CLI entry point
  template.ts       # Template fetch logic built on top of degit
  ui.ts             # Progress and error output
tests/
  cli.e2e.test.ts   # CLI end-to-end tests (degit mocked)
  config-editor.test.ts
  template.test.ts
types/
  degit.d.ts        # Type definition for degit
```

### Development Commands

```bash
npm run build       # Bundle with tsup
npm run lint        # ESLint
npm run typecheck   # TypeScript type checking
npm run test        # Vitest (unit + E2E)
npm run dev         # tsup watch mode
```

`npm run build` generates `dist/index.js`; run it with `node dist/index.js <project-name>`.  
You can also `npm link` to test the full `npm create hibana` flow locally.

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
