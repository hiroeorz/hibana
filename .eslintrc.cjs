/** ESLint設定：TypeScriptとNode.js向けに最低限のルールを適用 */
module.exports = {
  root: true,
  env: {
    es2021: true,
    node: true
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    sourceType: "module",
    ecmaVersion: "latest"
  },
  plugins: ["@typescript-eslint", "promise", "n"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:promise/recommended",
    "plugin:n/recommended",
    "prettier"
  ],
  rules: {
    /** TypeScriptで型情報があるため明示的anyのみ警告 */
    "@typescript-eslint/no-explicit-any": "warn",
    /** 先頭に_を付けた未使用引数は許容する */
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
    ],
    /** Promiseチェーンのreturnはチェックを緩める */
    "promise/always-return": "off"
  }
};
