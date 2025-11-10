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

### スケジュール済み Cron イベント

Cloudflare Workers の Cron 発火タイミングは `wrangler.toml` の `[triggers].crons` に列挙します。Ruby 側では `cron` DSL で処理を定義します。

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
  puts "Cron event: #{event.cron}"
end
```

- ハンドラは宣言順に判定され、マッチしたものはすべて実行されます。最後に `cron "*"` を置けばフォールバックとして利用できます。
- ブロックの第1引数 `event` には Workers から渡されたメタデータ（`event.cron`, `event.scheduled_time`, `event.retry_count` など）が入り、第2引数 `ctx` は HTTP ルートと同じ `env(:KV)` などを備えた `ScheduledContext` です。
- `wrangler.toml` に設定済みなのに Ruby 側にハンドラがない Cron が動くと、毎回警告が表示されるため定義漏れにすぐ気付けます。
- `export default runtime` と書けば `scheduled` ハンドラも自動的にエクスポートされます。個別に組み立てる場合は `runtimeScheduled(event, env, ctx)` を呼び出してください。


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

### ルートパラメータ

コロン付きセグメントでパスの一部をキャプチャできます。取得した値はクエリーパラメータと同じ `c.params` に入り、キーが衝突した場合はパス側が優先されます。単一の値だけ欲しい場合は `c.path_param(:id)` を利用できます。

`app/app.rb`

```ruby
get "/posts/:id" do |c|
  c.json(id: c.params[:id])
end
```

ワイルドカード（`*path`）や正規表現でも柔軟にマッチングできます。

`app/app.rb`

```ruby
get "/assets/*path" do |c|
  c.text("Serving #{c.path_param(:path)}")
end

get %r{\A/users/(?<id>\d+)\z} do |c|
  c.text("User ##{c.params['id']}")
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

### ビルドとテスト

ルートから npm スクリプトを実行すれば、両ワークスペースをまとめて操作できます。Makefile でも同じ処理を呼び出せます。

| 作業 | npm コマンド | make |
| --- | --- | --- |
| 依存インストール | `npm run deps` | `make deps` |
| 2パッケージのビルド | `npm run build:all`（`npm run build` でも可） | `make build` |
| 2パッケージのテスト | `npm run test:all`（`npm run test` でも可） | `make test` |
| 成果物の削除 | `npm run clean` | `make clean` |
| バージョン確認 | `npm run versions` | `make versions` |

個別に動かしたい場合は `npm run build:runtime` や `npm run test:cli`、`npm run lint --workspace create-hibana` のようにワークスペース宛てのスクリプトを呼んでください。

### ローカル CLI / ランタイム連携

未公開の変更を `npm link` で試す際は次のヘルパーを使います。

- `npm run install:local`（または `make install`）  
  ランタイムと CLI をビルドし、`@hibana-apps/runtime` / `create-hibana` をグローバルリンクします。さらに CLI 側がリンク済みランタイムを見るよう配線されるため、そのまま `create-hibana` コマンドでローカルソースを試せます。
- `npm run uninstall:local`（または `make uninstall`）  
  上記のリンクをすべて解除します。

生成したプロジェクト内でローカルランタイムを使いたい場合は、そのプロジェクトで次を実行してください。

```bash
npm install ../hibana/packages/runtime
```

検証後は `npm install @hibana-apps/runtime@latest` で公開版へ戻せます。

### npm への公開

次のコマンドでリリース作業をまとめて実行できます。

```bash
make publish VERSION=0.2.0
```

処理内容:

1. 作業ツリーがクリーンかを確認（`ALLOW_DIRTY=1` でスキップ可能）。
2. `scripts/bump-version.mjs` でバージョンを書き換え。`VERSION` を指定すると CLI/ランタイムを同一バージョンに揃えます。片方だけ変えたい場合は `CLI_VERSION` / `RUNTIME_VERSION` を個別指定してください。
3. `npm run deps`, `npm run test:all`, `npm run build:all` を順に実行。
4. ランタイム → CLI の順で `npm publish --tag $(TAG)` を実行（既定タグは `latest`。`TAG=beta` などで上書き可能）。

事前に `hibana-apps` 組織へ publish できるアカウントで `npm login` しておいてください。

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
