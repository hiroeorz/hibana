import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify as toToml, parse as parseToml } from "@iarna/toml";
import {
  RUNTIME_PACKAGE_NAME,
  RUNTIME_PACKAGE_VERSION,
} from "./constants.js";
import { ConfigUpdateError } from "./errors.js";

/** 設定ファイル更新時に必要な情報 */
export interface ConfigUpdateOptions {
  projectName: string;
  targetDir: string;
  wranglerName?: string;
}

/** テンプレート展開後の設定ファイルを書き換える */
export async function updateConfigs(
  options: ConfigUpdateOptions
): Promise<void> {
  await updatePackageJson(options);
  await updateWranglerToml(options);
}

/** package.jsonのnameフィールドを更新 */
async function updatePackageJson(options: ConfigUpdateOptions) {
  const path = join(options.targetDir, "package.json");
  try {
    const raw = await readFile(path, "utf8");
    const json = JSON.parse(raw) as Record<string, unknown>;
    json.name = options.projectName;
    const dependencies =
      (json.dependencies as Record<string, unknown> | undefined) ?? {};
    dependencies[RUNTIME_PACKAGE_NAME] = RUNTIME_PACKAGE_VERSION;
    json.dependencies = dependencies;
    const updated = JSON.stringify(json, null, 2);
    await writeFile(path, `${updated}\n`, "utf8");
  } catch (error) {
    throw new ConfigUpdateError(
      `Failed to update package.json: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/** wrangler.tomlのnameフィールドを更新 */
async function updateWranglerToml(options: ConfigUpdateOptions) {
  const path = join(options.targetDir, "wrangler.toml");
  try {
    const raw = await readFile(path, "utf8");
    const data = parseToml(raw) as Record<string, unknown>;
    const next = {
      ...data,
      name: options.wranglerName ?? options.projectName
    };
    await writeFile(path, toToml(next), "utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return;
    }
    throw new ConfigUpdateError(
      `Failed to update wrangler.toml: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
