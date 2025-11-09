# Hibana 🧨

Hibanaは、Cloudflare Workers 上でRubyアプリケーションを動作できるようにするためのフレームワークです。
プロジェクト作成後は、Hono・Sinatraライクなシンプルな構文で HTTP API を記述できます。

`npm create hibana@latest <project-name>` を実行するだけでテンプレートのダウンロード、設定ファイルの初期化、次の手順案内までを自動化します。

実際の開発・ビルド・デプロイはテンプレートに含まれるWranglerコマンドに委ねます。

テンプレート共通処理（Ruby/TypeScriptブリッジや Cloudflare サービスラッパー）は `@hibana-apps/runtime` として切り出されており、生成されたプロジェクトはこのパッケージを依存に持ちます。ランタイムの更新は `npm install @hibana-apps/runtime@latest` で取り込めます。

注意： 本アプリケーションはアルファ段階です。

本ソフトウェアは、Cloudflare Workers上で動作するRubyのプロジェクトテンプレートを生成する機能のみ提供します。
Cloudflare Workers 上でどのような仕組みでRubyプログラムが動作するのか知りたい場合は、[テンプレート（hiroeorz
cloudflare_workers_ruby_template）](https://github.com/hiroeorz/cloudflare_workers_ruby_template/)の `README.md` や `docs` 以下のドキュメントをご覧ください。

---

## 目標

- Rubyコードを Cloudflare Workers で実行する為の最小構成テンプレートの提供。
- Rubyユーザーにとってシンプルで扱いやすいインターフェイス

## 使い方

新規プロジェクトの開始

```bash
npm create hibana@latest <project-name>
```

初期セットアップ

```bash
npm install
```

開発サーバーの起動

```bash
npm run dev
```

ブラウザで http://localhost:8787 へアクセスすると初期ページが表示されます。

## コード例

### Hello World

`app/app.rb`

```ruby
get "/" do |c|
  c.text("Hello Hibana ⚡")
end
```

### D1連携

`app/app.rb`

```ruby
get "/d1" do |c|
  db = c.env(:DB)
  result = db.prepare("SELECT * FROM posts WHERE id = ?").bind(1).first
  c.text(result)
end
```

### KV連携

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

### R2連携

`app/app.rb`

```ruby
get "/r2" do |c|
  key = "ruby-r2-key"
  value = "Hello from R2 sample!"

  bucket = c.env(:MY_R2)
  bucket.put(key, value) # 保存
  read_value = bucket.get(key).text # 参照

  c.text("Wrote '#{value}' to R2. Read back: '#{read_value}'")
end
```

### Workers AI 連携

Workers AI との連携もできます。渡すパラメータはモデルによって異なるので注意してください。

LLMに `@cf/meta/llama-3.1-8b-instruct-fast` を使う場合のサンプル。

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
  c.json({prompt: prompt, result: result})
rescue WorkersAI::Error => e
  c.json({ error: e.message, details: e.details }, status: 500)
end
```

LLMに `gpt-oss-20b` を使う場合のサンプル。

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
        summary: "auto"
      }
    },
  )
  c.json({prompt: prompt, result: result})
rescue WorkersAI::Error => e
  c.json({ error: e.message, details: e.details }, status: 500)
end
```


### リダイレクト

`app/app.rb`

```ruby
get "/legacy" do |c|
  c.redirect("/new-home")
end

get "/docs" do |c|
  c.redirect("/docs/latest", status: 301)
end
```

### HTTPクライアント

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

### テンプレートレンダリング（ERB）

生成されたプロジェクトには `templates/` ディレクトリがあり、ERB テンプレートを配置すると `RequestContext#render` で描画できます。レイアウトは `templates/layouts/` 以下に置き、既定では `layouts/application.html.erb` が自動的に適用されます。

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

ルートからの呼び出し例:

`app/app.rb`

```ruby
get "/" do |c|
  c.render("index", name: "Hibana", age: 50)
end
```

- 拡張子を省略すると `.html.erb` → `.erb` の順で補完します。
- `layout: false` を指定するとレイアウトをスキップ、`layout: "layouts/marketing"` のように明示すれば任意のレイアウトを利用できます。
- HTML だけ必要な場合は `render_to_string("users/show", locals: { name: "Hiroe" })` が利用できます。

テンプレートを追加したら `npm run build:generated`（`dev`/`deploy`/`test` 実行前にも自動で呼ばれます）を実行し、`src/generated/template-assets.ts` を最新の状態に保ってください。

---


## hibana コマンドのオプション

| オプション | 説明 | 既定値 |
| --- | --- | --- |
| `--template <repo>` | テンプレートリポジトリ指定（`user/repo`形式） | `hiroeorz/cloudflare_workers_ruby_template` |
| `--ref <ref>` | テンプレートのGitリファレンス（タグ・ブランチ・コミット） | `main` |
| `--force` | 既存ディレクトリがある場合に上書き許可 | `false` |
| `--wrangler-name <name>` | `wrangler.toml` の `name` を任意値で上書き | 指定なし（`<project-name>`を使用） |

---

wrangler コマンドは事前にログインしておいてください。

```bash
wrangler login
```

テンプレートが提供する主なコマンド：

- 開発サーバ起動：`npx wrangler dev` または `npm run dev`
- ビルド：`npx wrangler build`
- Cloudflare Workers へデプロイ：`npx wrangler deploy`
- D1マイグレーション：`npm run db:migrate`

テンプレート内の詳細は生成された `README.md` を参照してください。

---

## 開発者向け情報

### ワークスペース構成

```
packages/
  cli/              # CLI本体（create-hibana）
    src/            # コマンド実装
    tests/          # Vitest（ユニット＋E2E）
  runtime/          # 共有ランタイム (@hibana-apps/runtime)
    src/            # TypeScript / Ruby ブリッジ資産
    tests/          # ランタイム向けユニットテスト
```

ルートでは npm workspaces を利用しています。`npm install` を一度実行すると、両パッケージの依存がまとめて解決されます。

### 主なスクリプト

```bash
# 依存インストール（ルートで実行）
npm install

# CLI
npm run build --workspace create-hibana
npm run test  --workspace create-hibana
npm run lint  --workspace create-hibana
npm run typecheck --workspace create-hibana

# ランタイム
npm run build --workspace @hibana-apps/runtime
npm run test  --workspace @hibana-apps/runtime
npm run typecheck --workspace @hibana-apps/runtime
```

`npm run build`（ルート）を実行すると、ワークスペース配下の `build` スクリプトが順番に呼び出され、CLI もランタイムも一括ビルドできます。

### ローカルで CLI を試す

1. 依存を準備し、CLI とランタイムをビルドします。
   ```bash
   npm install
   npm run build --workspace @hibana-apps/runtime
   npm run build --workspace create-hibana
   ```
2. CLI をグローバルリンクします。
   ```bash
   (cd packages/cli && npm link)
   ```
3. 任意の場所で `create-hibana <project-name>` を実行すると、ローカル変更を含んだ CLI を使ってテンプレートを生成できます。不要になったら `npm unlink -g create-hibana` と `(cd packages/cli && npm unlink)` で解除してください。

### ランタイム + CLI をローカルで組み合わせて試す

公開前の変更をテンプレート／生成プロジェクトで検証したい場合は、以下の手順で環境を揃えます。

1. **ランタイム（`@hibana-apps/runtime`）のビルド**
   - `cd ~/src/cloudflare/hibana && npm install`
   - `npm run build --workspace @hibana-apps/runtime`
2. **CLI をビルドしてリンク**
   - `npm run build --workspace create-hibana`
   - `(cd packages/cli && npm link)` （`create-hibana` コマンドがローカル版になります）
3. **テンプレートでローカルランタイムを参照**
   - テンプレートディレクトリへ移動して `npm install`
   - `npm install ../hibana/packages/runtime`
4. **ローカル CLI でプロジェクトを生成**
   - `create-hibana my-app --template hiroeorz/cloudflare_workers_ruby_template`
   - `cd my-app && npm install`
   - `npm install ../hibana/packages/runtime`
5. **開発・検証**
   - `npm run build:generated`
   - `npx wrangler dev`
6. **片付け**
   - `npm unlink -g create-hibana` と `(cd packages/cli && npm unlink)`
   - 公開版ランタイムへ戻す場合は `npm install @hibana-apps/runtime@latest`

### npm への公開フロー

1. ランタイム（`@hibana-apps/runtime`）の公開
   ```bash
   npm run build --workspace @hibana-apps/runtime
   cd packages/runtime
   npm publish --access public
   cd ../..
   ```
   ※ npm で `hibana-apps` 組織に権限を持つアカウントでログインしている必要があります。

2. CLI（`create-hibana`）の公開
   1. `packages/cli/src/constants.ts` の `RUNTIME_PACKAGE_VERSION` を公開したランタイムのバージョンに合わせます。
   2. `packages/cli/package.json` の `version` を必要に応じて上げます。
   3. 依存解決とテスト／ビルドを実行します。
      ```bash
      npm install
      npm run test --workspace create-hibana
      npm run build --workspace create-hibana
      ```
   4. 公開します。
      ```bash
      cd packages/cli
      npm publish --access public
      cd ../..
      ```

---

## ライセンス

MIT License

---

### リダイレクト

```ruby
get "/legacy" do |c|
  c.redirect("/new-home", status: 301)
end
```
