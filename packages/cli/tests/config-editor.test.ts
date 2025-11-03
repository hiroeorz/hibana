import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { updateConfigs } from "../src/config-editor.js";
import { ConfigUpdateError } from "../src/errors.js";
import {
  RUNTIME_PACKAGE_NAME,
  RUNTIME_PACKAGE_VERSION,
} from "../src/constants.js";

const createdDirs: string[] = [];

/** テスト用一時ディレクトリを作成 */
async function createTempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hibana-test-"));
  createdDirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.allSettled(
    createdDirs.map((dir) =>
      rm(dir, { recursive: true, force: true }).catch(() => undefined)
    )
  );
});

describe("updateConfigs", () => {
  it("package.jsonとwrangler.tomlを更新できる", async () => {
    const dir = await createTempProject();
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "template-app", version: "0.1.0" }, null, 2),
      "utf8"
    );
    await writeFile(
      join(dir, "wrangler.toml"),
      'name = "template-app"\nmain = "src/index.ts"\n',
      "utf8"
    );

    await updateConfigs({
      projectName: "my-app",
      targetDir: dir
    });

    const updatedPackage = JSON.parse(
      await readFile(join(dir, "package.json"), "utf8")
    );
    const updatedWrangler = await readFile(
      join(dir, "wrangler.toml"),
      "utf8"
    );

    expect(updatedPackage.name).toBe("my-app");
    expect(updatedWrangler).toContain('name = "my-app"');
    expect(
      (updatedPackage.dependencies ?? {})[RUNTIME_PACKAGE_NAME]
    ).toBe(RUNTIME_PACKAGE_VERSION);
  });

  it("wrangler.tomlが存在しない場合でも成功する", async () => {
    const dir = await createTempProject();
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "template-app" }, null, 2),
      "utf8"
    );

    await expect(
      updateConfigs({
        projectName: "my-app",
        targetDir: dir
      })
    ).resolves.not.toThrow();
  });

  it("package.jsonが存在しない場合はエラーを返す", async () => {
    const dir = await createTempProject();

    await expect(
      updateConfigs({
        projectName: "my-app",
        targetDir: dir
      })
    ).rejects.toBeInstanceOf(ConfigUpdateError);
  });
});
