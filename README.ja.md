# Hibana 🧨

Hibanaは、Cloudflare Workers + Ruby構成のテンプレートを手早く取得するための最小構成CLIです。
プロジェクト作成後は、Hono・Sinatraライクなシンプルな構文で HTTP API を記述できます。

`npm create hibana@latest <project-name>` を実行するだけでテンプレートのクローン、設定ファイルの初期化、次の手順案内までを自動化します。実際の開発・ビルド・デプロイはテンプレートに含まれるWranglerコマンドに委ねます。

注意： 本アプリケーションはアルファ段階です。

本ソフトウェアは、Cloudflare Workers上で動作するRubyのプロジェクトテンプレートを生成する機能のみ提供します。
Cloudflare Workers 上でどのような仕組みでRubyプログラムが動作するのか知りたい場合は、[テンプレート（hiroeorz
cloudflare_workers_ruby_template）](https://github.com/hiroeorz/cloudflare_workers_ruby_template/)の `README.md` や `docs` 以下のドキュメントをご覧ください。

---

## 目標

- Rubyコードを Cloudflare Workers で実行する為の最小構成テンプレートの提供。
- Rubyユーザーにとってシンプルで扱いやすいインターフェイス

## コード例

### Hello World

```ruby
get "/" do |c|
  c.text("Hello from Ruby WASM")
end
```

### D1連携

```ruby
get "/d1" do |c|
  db = c.env(:DB)
  result = db.prepare("SELECT * FROM posts WHERE id = ?").bind(1).first
  c.text(result)
end
```

### R2連携

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

---

## 使い方

### プロジェクトの新規作成

```bash
npm create hibana@latest <project-name>
```

### CLIオプション

| オプション | 説明 | 既定値 |
| --- | --- | --- |
| `--template <repo>` | テンプレートリポジトリ指定（`user/repo`形式） | `hiroeorz/cloudflare_workers_ruby_template` |
| `--ref <ref>` | テンプレートのGitリファレンス（タグ・ブランチ・コミット） | `main` |
| `--force` | 既存ディレクトリがある場合に上書き許可 | `false` |
| `--wrangler-name <name>` | `wrangler.toml` の `name` を任意値で上書き | 指定なし（`<project-name>`を使用） |


---

## 生成後のテンプレート操作

生成されたプロジェクトに移動して依存関係をセットアップします。

```bash
cd <project-name>
npm install
```

開発サーバーの起動

```bash
npx wrangler dev
```

ブラウザで http://localhost:8787 へアクセスすると初期ページが表示されます。

テンプレートが提供する主なコマンド：

- 開発サーバ起動：`npx wrangler dev`
- ビルド：`npx wrangler build`
- Cloudflare Workers へデプロイ：`npx wrangler deploy`
- D1マイグレーション：`npm run db:migrate`

テンプレート内の詳細は生成された `README.md` を参照してください。

---

## 開発者向け情報

### リポジトリ構成

```
src/
  config-editor.ts  # テンプレート展開後の設定ファイル更新ロジック
  constants.ts      # テンプレート関連の既定値定義
  errors.ts         # CLI内で使用するカスタムエラー
  index.ts          # CLIエントリーポイント
  template.ts       # degitを利用したテンプレート取得処理
  ui.ts             # 進行状況とエラーメッセージ表示
tests/
  cli.e2e.test.ts   # CLI全体のE2Eテスト（degitをモック）
  config-editor.test.ts
  template.test.ts
types/
  degit.d.ts        # degit用型定義
```

### 開発コマンド

```bash
npm run build       # tsupによるバンドル
npm run lint        # ESLint
npm run typecheck   # TypeScriptの型チェック
npm run test        # Vitest（ユニット＋E2Eテスト）
npm run dev         # tsupウォッチビルド
```

`npm run build` で生成される `dist/index.js` は `node dist/index.js <project-name>` で直接実行可能です。`npm link` を利用すると `npm create hibana` 形式でのローカル動作確認も容易になります。

---

## ライセンス

MIT License

---

## Q&A

- **テンプレートの更新にはどう対応する？**  
  現在のCLIは生成時のクローンのみ対応します。テンプレート更新を取り込む場合は、個別にテンプレートを再取得するか、手動でマージしてください。

- **WranglerコマンドをCLIに統合できる？**  
  追加のコマンドは将来の拡張として検討可能ですが、初期バージョンではテンプレートの生成に特化しています。

- **テンプレートURLを切り替えたい**  
  `--template` と `--ref` オプションで任意のテンプレート／バージョンを指定できます。
