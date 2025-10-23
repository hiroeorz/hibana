# **プロジェクト「Hibana」(仮) 企画書 (初版)**

## **1. 概要と目的**

本プロジェクトの目的は、**Cloudflare Workers のエッジ環境で動作する、Ruby のための軽量アプリケーションフレームワーク「Hibana」を開発すること**である。

Ruby 3.4 以降で標準サポートされる WASM/WASI を活用し、Rubyist が慣れ親しんだ開発体験 (DX) を保ちながら、エッジコンピューティングの低レイテンシーとスケーラビリティの恩恵を受けられるようにする。

Rails のような重量級フレームワークではなく、Sinatra のような手軽さと、Hono のようなモダンな設計思想を融合させた、WASM 環境に最適化された最小限の構成を目指す。

## **2. 外部仕様 (開発者インターフェイス)**

開発者が直接触れるインターフェイス。シンプルで直感的な操作性を最優先する。

### **2.1. コマンドラインインターフェイス (CLI)**

hibana コマンドは、プロジェクトの生成からデプロイまでの開発サイクルをシームレスにサポートする。

- **hibana new <project_name>**
  - 新規プロジェクトの雛形を生成する。
  - wrangler.toml、src/index.ts (WASM 起動シム)、app/app.rb (Ruby 本体)、package.json 等、最小限の "Hello World" が動作する構成を自動生成する。
- **hibana dev**
  - ローカル開発サーバーを起動する (wrangler dev のラッパー)。
  - app/ 以下の Ruby ファイルの変更を監視し、WASM の自動リビルドとサーバーのリロードを行う。
- **hibana deploy**
  - 本番環境用に Ruby (WASM) を最適化ビルドし、Cloudflare Workers にデプロイする (wrangler deploy のラッパー)。
- **hibana db:schema:pull**
  - wrangler.toml に設定された D1 データベースからスキーマ情報 (テーブル、カラム) を取得し、検証用のマニフェストファイル (schema.manifest.json) を生成・更新する。
- **hibana db:migrate**
  - db/migrations ディレクトリ内の SQL ファイルを D1 データベースに適用する (wrangler d1 migrations apply のラッパー)。

#### **2.1.1. 配布形態 (CLI)**

hibana CLI ツールは、**Node.js ライブラリ (npm パッケージ)** として配布する。

- **理由:**
  - hibana コマンドの責務は、Ruby (WASM) のビルドと、Cloudflare の wrangler コマンドの呼び出しを仲介することである。
  - wrangler 自体が Node.js 製であり、npm エコシステムに強く依存している。
  - npm パッケージとして配布し、package.json で wrangler に依存することにより、ユーザーは npm install -g hibana を実行するだけで、開発に必要な全てのツールチェーン（hibana 本体と wrangler）を一度にインストールできる。
  - これにより、Rubyist にとっては「Ruby フレームワークなのに npm を使う」という初期体験になるが、それ以上に「コマンド一つで環境構築が完了する」という優れた開発体験 (DX) を提供できる。

### **2.2. ルーティング API (DSL)**

Ruby 側 (app/app.rb) で記述する API の仕様。Sinatra ライクな記法を採用しつつ、リクエスト/レスポンスの扱いは Hono に倣い、**コンテキストオブジェクト (c)** を介して行う。

これにより、明示的でテストしやすく、拡張性の高い設計を実現する。

# app/app.rb

require 'hibana'

# --- 基本的なルーティング ---

get '/' do |c|  
 c.text "Hello Hibana! 🎇"  
end

# --- パスパラメータとクエリ ---

get '/users/:id' do |c|  
 user_id = c.param('id') # パスパラメータ  
 show_meta = c.query('meta') # クエリ (?meta=true)

c.json(id: user_id, meta: show_meta == 'true')  
end

# --- POST (JSON ボディのパース) ---

post '/todos' do |c|  
 begin

# JSON ボディをパース

data = c.req.json  
 rescue Hibana::BadRequestError => e

# パース失敗時のハンドリング

c.status(400)  
 next c.json(error: "Invalid JSON")  
 end

# D1 への保存処理 (c.env 経由)

# new_todo = c.env.DB.todos.insert(title: data['title'])

c.status(201) # Created  
 c.json(status: 'created', id: new_todo.id)  
end

# --- ヘッダとステータスの制御 ---

get '/protected' do |c|  
 auth = c.req.header('Authorization')

unless valid_auth?(auth)  
 c.status(401)  
 c.res.headers['WWW-Authenticate'] = 'Bearer realm="example"'  
 next c.text('Unauthorized')  
 end

c.text('Welcome, authorized user')  
end

**コンテキストオブジェクト (c) の責務:**

- **リクエスト (c.req)**: c.param, c.query, c.req.json, c.req.header
- **レスポンス (c.res)**: c.text, c.json, c.status, c.res.headers
- **環境 (c.env)**: D1, KV, R2 などのバインディングへのアクセス (後述)

## **3. 内部仕様 (アーキテクチャ)**

フレームワークの動作原理と、WASM/JS 間の連携方法。

### **3.1. 基本アーキテクチャ (WASM 実行モデル)**

Hono (JS ルーター) は採用せず、ルーティングを含むアプリケーションの主処理はすべて Ruby (WASM) 側で実行する。

1. **src/index.ts (TS/JS シム)**
   - Cloudflare Workers のエントリポイント。
   - 責務は app.rb からビル д された app.wasm (Ruby VM + スクリプト) をロードすることのみ。
   - リクエストが来たら、リクエスト情報を WASM に渡し、Ruby 側の処理を実行する。
   - Ruby から返されたレスポンス情報 (ステータス, ヘッダ, ボディ) を受け取り、CFW の Response オブジェクトとして返す。
2. **app.rb (Ruby/WASM 本体)**
   - TS シムからリクエスト情報を受け取る。
   - Hibana のルーティングロジックが起動し、app.rb に定義されたマッチするブロック (例: get '/' do ... end) を実行する。
   - レスポンス情報を構築し、TS シムに返す。

### **3.2. Cloudflare バインディング連携 (D1/KV/R2)**

WASM (Ruby) とホスト (JS) 間の非同期 API (D1 など) 連携は、本プロジェクトにおける最大の技術的課題である。

この解決策として、**「JSON Plan アダプタ」**パターンを採用する。

1. **TS (ホスト) 側: 「汎用アダプタ」**
   - src/index.ts (あるいは別ファイル) に、\_\_d1Exec(plan) のような汎用関数を globalThis に公開する。
   - この関数は Ruby から渡された plan (JSON オブジェクト) を受け取る。
   - plan に基づき、安全な SQL (プリペアドステートメント + バインド変数) を動的に構築する。
   - schema.manifest.json を参照し、テーブル名やカラム名をホワイトリスト検証し、SQL インジェクションを防ぐ。
   - D1 を await で実行し、結果を JSON として Ruby 側に返す。
   - (KV, R2 も同様のアダプタ **kvGet(key), **r2Put(key, body) を用意する)
2. **Ruby (WASM) 側: 「DSL (ORM)」**
   - 開発者は Todos.where(done: false).limit(10).all のような Ruby らしい DSL を記述する。
   - この DSL は、SQL を直接生成するのではなく、TS アダプタが解釈できる **plan (JSON)** を構築する。
     - 例: { op: 'select', table: 'todos', where: { eq: { col: 'done', val: false } }, limit: 10 }
   - js gem の機能 (Ruby 3.4 標準) を使い、TS 側の関数を呼び出す。

# Ruby DSL の内部イメージ

plan = { op: 'select', ... }

# JS.global が TS 側の \_\_d1Exec を呼び出す

# 'js' gem が Promise の完了を自動的に待機 (await) してくれる

result_array = JS.global[:__d1Exec].call(plan).to_ruby

### **3.3. この設計の利点**

- **関心の分離**: Ruby は「何がしたいか (DSL)」に集中し、TS は「どう安全に実行するか (SQL 構築/検証)」に集中できる。
- **非同期の解決**: js gem のブリッジ機能が JS 側の Promise を吸収するため、Ruby 側は同期的な (await を意識しない) コードを書くことができる。
- **データ型の解決**: WASM リニアメモリ操作を避け、シリアライズが容易な **JSON** のみをインターフェイスとして通信するため、ブリッジのコストが低い。
- **セキュリティ**: SQL インジェクションのリスクを TS アダプタ側で一元的に防御できる。
