import kleur from "kleur";

/** 処理開始時の案内を表示 */
export function renderStart(projectName: string) {
  console.log(
    kleur.cyan().bold(`Scaffolding Cloudflare Worker project "${projectName}"`)
  );
}

/** ステップ処理の進行を表示 */
export function renderStep(message: string) {
  console.log(`${kleur.cyan("→")} ${message}`);
}

/** 正常終了時に次の手順を案内 */
export function renderSuccess(projectName: string) {
  console.log(kleur.green().bold("Done!"));
  console.log("");
  console.log(kleur.bold("Next steps:"));
  console.log(`  ${kleur.gray("$")} cd ${projectName}`);
  console.log(`  ${kleur.gray("$")} npm install`);
  console.log(`  ${kleur.gray("$")} npm run dev`);
  console.log("");
  console.log(
    kleur.gray("Refer to Wrangler documentation for deploy and migrations.")
  );
}

/** エラー発生時の表示 */
export function renderError(title: string, detail?: string) {
  console.error(kleur.red().bold(`Error: ${title}`));
  if (detail) {
    console.error(kleur.red(detail));
  }
}
