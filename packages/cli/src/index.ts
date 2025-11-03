import { Command } from "commander";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  ConfigUpdateError,
  ProjectDirExistsError,
  TemplateDownloadError,
  TemplateFinalizeError
} from "./errors.js";
import { cloneTemplate, finalizeTemplate } from "./template.js";
import { updateConfigs } from "./config-editor.js";
import {
  DEFAULT_TEMPLATE_REF,
  DEFAULT_TEMPLATE_REPO
} from "./constants.js";
import {
  renderError,
  renderStart,
  renderStep,
  renderSuccess,
  startSpinner,
  stopSpinner
} from "./ui.js";

/** CLIオプションの型定義 */
interface CliOptions {
  template?: string;
  ref?: string;
  force?: boolean;
  wranglerName?: string;
}

/** CLI全体の実行を司るメイン処理 */
export async function runCli(argv: string[]) {
  const program = new Command();
  program
    .name("create-hibana")
    .description(
      "Scaffold a Cloudflare Workers + Ruby project from the template repository."
    )
    .argument("<project-name>", "Project directory name")
    .option(
      "--template <repo>",
      "Template repository reference (user/repo)",
      DEFAULT_TEMPLATE_REPO
    )
    .option(
      "--ref <ref>",
      "Template git reference (branch, tag, commit)",
      DEFAULT_TEMPLATE_REF
    )
    .option("--force", "Overwrite target directory if it already exists", false)
    .option(
      "--wrangler-name <name>",
      "Override wrangler.toml `name` field with a custom value"
    );

  program.parse(argv);
  const projectName = program.args[0];
  if (!projectName) {
    program.outputHelp();
    throw new Error("Project name is required.");
  }
  const options = program.opts<CliOptions>();
  const targetDir = resolve(process.cwd(), projectName);

  renderStart(projectName);
  renderStep("Fetching template");
  startSpinner("Downloading template");
  await cloneTemplate({
    projectName,
    targetDir,
    templateRepo: options.template,
    templateRef: options.ref,
    force: options.force
  });
  stopSpinner();

  renderStep("Preparing template files");
  await finalizeTemplate(targetDir);

  renderStep("Updating configuration");
  await updateConfigs({
    projectName,
    targetDir,
    wranglerName: options.wranglerName
  });

  renderSuccess(projectName);
}

/** CLI実行時の共通エラーハンドリング */
function handleCliError(error: unknown) {
  if (error instanceof ProjectDirExistsError) {
    renderError(
      "Target directory already exists.",
      "Use --force to overwrite the existing directory."
    );
  } else if (error instanceof TemplateDownloadError) {
    renderError("Failed to download template.", error.message);
  } else if (error instanceof TemplateFinalizeError) {
    renderError("Failed to prepare template.", error.message);
  } else if (error instanceof ConfigUpdateError) {
    renderError("Failed to update configuration files.", error.message);
  } else if (error instanceof Error) {
    renderError("Unexpected error occurred.", error.message);
  } else {
    renderError("Unknown error.", undefined);
  }
  process.exitCode = 1;
}

/** エントリーポイント */
function shouldExecuteCli(): boolean {
  const entryPath = fileURLToPath(import.meta.url);
  const invokedPath = process.argv.length > 1 ? process.argv[1] : null;
  if (!invokedPath) {
    return false;
  }
  try {
    return realpathSync(invokedPath) === realpathSync(entryPath);
  } catch {
    return false;
  }
}

if (shouldExecuteCli()) {
  runCli(process.argv).catch(handleCliError);
}

export { handleCliError };
