import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TEMPLATE_REF, DEFAULT_TEMPLATE_REPO } from "../src/constants.js";
import { cloneTemplate, finalizeTemplate } from "../src/template.js";
import {
  ProjectDirExistsError,
  TemplateFinalizeError
} from "../src/errors.js";

const degitCloneMock = vi.fn();
const degitFactoryMock = vi.fn(
  (_spec: string, _options: Record<string, unknown>) => ({
    clone: degitCloneMock
  })
);

vi.mock("degit", () => ({
  default: (spec: string, options: Record<string, unknown>) => {
    return degitFactoryMock(spec, options);
  }
}));

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "hibana-template-"));
  degitCloneMock.mockReset().mockResolvedValue(undefined);
  degitFactoryMock.mockClear();
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
});

describe("cloneTemplate", () => {
  it("既存ディレクトリがある場合はエラーとなる", async () => {
    const target = join(tempRoot, "exists");
    await mkdir(target);

    await expect(
      cloneTemplate({
        projectName: "demo",
        targetDir: target
      })
    ).rejects.toBeInstanceOf(ProjectDirExistsError);
  });

  it("force指定時は既存ディレクトリでも続行する", async () => {
    const target = join(tempRoot, "force");
    await mkdir(target);

    await expect(
      cloneTemplate({
        projectName: "demo",
        targetDir: target,
        force: true
      })
    ).resolves.not.toThrow();
    expect(degitFactoryMock).toHaveBeenCalledWith(
      `${DEFAULT_TEMPLATE_REPO}#${DEFAULT_TEMPLATE_REF}`,
      expect.objectContaining({ force: true })
    );
  });

  it("既定のテンプレートが使用される", async () => {
    const target = join(tempRoot, "fresh");

    await cloneTemplate({
      projectName: "demo",
      targetDir: target
    });

    expect(degitFactoryMock).toHaveBeenCalledWith(
      `${DEFAULT_TEMPLATE_REPO}#${DEFAULT_TEMPLATE_REF}`,
      expect.objectContaining({ force: false })
    );
    expect(degitCloneMock).toHaveBeenCalledWith(target);
  });
});

describe("finalizeTemplate", () => {
  it("app.rbをバックアップしてシンプル版に差し替える", async () => {
    const target = join(tempRoot, "finalize-success");
    await mkdir(join(target, "app"), { recursive: true });
    await writeFile(join(target, "app", "app.rb"), "full version\n", "utf8");
    await writeFile(
      join(target, "app", "app-simple.rb"),
      "simple version\n",
      "utf8"
    );

    await finalizeTemplate(target);

    const fullBackup = await readFile(
      join(target, "app", "app-full.rb"),
      "utf8"
    );
    const activeEntry = await readFile(join(target, "app", "app.rb"), "utf8");

    expect(fullBackup).toBe("full version\n");
    expect(activeEntry).toBe("simple version\n");
  });

  it("app.rbが存在しない場合はエラーになる", async () => {
    const target = join(tempRoot, "missing-original");
    await mkdir(join(target, "app"), { recursive: true });
    await writeFile(
      join(target, "app", "app-simple.rb"),
      "simple version\n",
      "utf8"
    );

    await expect(finalizeTemplate(target)).rejects.toBeInstanceOf(
      TemplateFinalizeError
    );
  });

  it("app-simple.rbが存在しない場合はエラーになる", async () => {
    const target = join(tempRoot, "missing-simple");
    await mkdir(join(target, "app"), { recursive: true });
    await writeFile(join(target, "app", "app.rb"), "full version\n", "utf8");

    await expect(finalizeTemplate(target)).rejects.toBeInstanceOf(
      TemplateFinalizeError
    );
  });
});
