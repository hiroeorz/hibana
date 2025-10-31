## npm 公開手順

1. 依存関係とビルドを最新化する  
   ```bash
   npm install
   npm test
   npm run build
   ```
2. `dist/` の内容を確認し、必要に応じて `package.json` の `version` や CHANGELOG、タグなどを更新する  
3. パッケージ内容を確認する  
   ```bash
   npm pack
   # または
   npm publish --dry-run
   ```
4. レジストリへログインする  
   ```bash
   npm login
   ```
5. 公開する  
   ```bash
   npm publish --access public
   ```
6. 公開後の後処理  
   - Git タグやリリースノートを発行する  
   - ローカルで `npm link` を使っていた場合は `npm unlink` で片付ける
