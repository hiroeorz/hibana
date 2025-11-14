/** テンプレートリポジトリの既定指定 */
export const DEFAULT_TEMPLATE_REPO =
  "hiroeorz/cloudflare_workers_ruby_template";

/** 既定で指定するテンプレートのリファレンス */
export const DEFAULT_TEMPLATE_REF = "main";

/** テンプレート取得時のタイムアウト（ミリ秒） */
export const TEMPLATE_DOWNLOAD_TIMEOUT = 1000 * 60;

/** 生成プロジェクトに追加するランタイムパッケージ */
export const RUNTIME_PACKAGE_NAME = "@hibana-apps/runtime";

/** ランタイムパッケージの推奨バージョン */
export const RUNTIME_PACKAGE_VERSION = "^0.1.8";
