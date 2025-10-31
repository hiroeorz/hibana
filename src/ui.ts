import kleur from "kleur";

const SPINNER_FRAMES = ["|", "/", "-", "\\"];
let spinnerTimer: NodeJS.Timeout | undefined;
let spinnerLabel = "";
let spinnerIndex = 0;

/** 処理開始時の案内を表示 */
export function renderStart(projectName: string) {
  console.log(
    kleur.cyan().bold(`Scaffolding Cloudflare Worker project "${projectName}"`)
  );
}

/** ステップ処理の進行を表示 */
export function renderStep(message: string) {
  stopSpinner();
  console.log(`${kleur.cyan("→")} ${message}`);
}

/** 正常終了時に次の手順を案内 */
export function renderSuccess(projectName: string) {
  stopSpinner();
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
  stopSpinner();
  console.error(kleur.red().bold(`Error: ${title}`));
  if (detail) {
    console.error(kleur.red(detail));
  }
}

/** 単純なスピナー表示を開始する */
export function startSpinner(label: string) {
  stopSpinner();
  spinnerLabel = label;
  spinnerIndex = 0;
  process.stdout.write(`${label} ${SPINNER_FRAMES[spinnerIndex]}`);
  spinnerTimer = setInterval(() => {
    spinnerIndex = (spinnerIndex + 1) % SPINNER_FRAMES.length;
    process.stdout.write(`\r${label} ${SPINNER_FRAMES[spinnerIndex]}`);
  }, 120);
}

/** スピナー表示を停止する */
export function stopSpinner(finalMessage?: string) {
  if (!spinnerTimer) {
    if (finalMessage) {
      console.log(finalMessage);
    }
    return;
  }

  clearInterval(spinnerTimer);
  spinnerTimer = undefined;
  const blanks = " ".repeat(spinnerLabel.length + 2);
  process.stdout.write(`\r${blanks}\r`);
  if (finalMessage) {
    console.log(finalMessage);
  }
  spinnerLabel = "";
}
