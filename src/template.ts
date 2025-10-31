import { constants as fsConstants } from "node:fs";
import { access, copyFile } from "node:fs/promises";
import { join } from "node:path";
import degit from "degit";
import { DEFAULT_TEMPLATE_REF, DEFAULT_TEMPLATE_REPO } from "./constants.js";
import {
  ProjectDirExistsError,
  TemplateDownloadError,
  TemplateFinalizeError
} from "./errors.js";

/** テンプレート取得時のオプション */
export interface TemplateOptions {
  projectName: string;
  targetDir: string;
  templateRepo?: string;
  templateRef?: string;
  force?: boolean;
}

/** テンプレートリポジトリをクローンする */
export async function cloneTemplate(options: TemplateOptions): Promise<void> {
  const repo = options.templateRepo ?? DEFAULT_TEMPLATE_REPO;
  const ref = options.templateRef ?? DEFAULT_TEMPLATE_REF;
  const spec = ref ? `${repo}#${ref}` : repo;
  await ensureTargetAvailability(options.targetDir, options.force ?? false);
  const emitter = degit(spec, {
    cache: false,
    force: options.force ?? false,
    verbose: false
  });

  try {
    await emitter.clone(options.targetDir);
  } catch (error) {
    throw new TemplateDownloadError(
      error instanceof Error ? error.message : undefined
    );
  }
}

/** テンプレート取得後にエントリポイントの差し替えを行う */
export async function finalizeTemplate(targetDir: string): Promise<void> {
  const appDir = join(targetDir, "app");
  const defaultEntrypoint = join(appDir, "app.rb");
  const simpleEntrypoint = join(appDir, "app-simple.rb");
  const fullEntrypoint = join(appDir, "app-full.rb");

  await ensureTemplateFile(defaultEntrypoint, "app/app.rb");
  await ensureTemplateFile(simpleEntrypoint, "app/app-simple.rb");

  try {
    await copyFile(defaultEntrypoint, fullEntrypoint);
    await copyFile(simpleEntrypoint, defaultEntrypoint);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to adjust template entrypoints.";
    throw new TemplateFinalizeError(message);
  }
}

/** 出力先ディレクトリが既に存在する場合の判定を行う */
async function ensureTargetAvailability(path: string, force: boolean) {
  try {
    await access(path, fsConstants.F_OK);
    if (!force) {
      throw new ProjectDirExistsError(path);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
}

async function ensureTemplateFile(path: string, label: string): Promise<void> {
  try {
    await access(path, fsConstants.F_OK);
  } catch {
    throw new TemplateFinalizeError(
      `Template file "${label}" was not found in the downloaded template.`
    );
  }
}
