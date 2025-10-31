import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TEMPLATE_REF, DEFAULT_TEMPLATE_REPO } from "../src/constants.js";
import { cloneTemplate } from "../src/template.js";
import { ProjectDirExistsError } from "../src/errors.js";

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
