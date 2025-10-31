import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MockInstance } from "vitest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let tempRoot: string;
let cwdSpy: MockInstance<[], string>;

const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
const errorSpy = vi
  .spyOn(console, "error")
  .mockImplementation(() => undefined);

vi.mock("degit", () => ({
  default: () => ({
    clone: async (dir: string) => {
      await mkdir(dir, { recursive: true });
      await mkdir(join(dir, "app"), { recursive: true });
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({ name: "template-app" }, null, 2),
        "utf8"
      );
      await writeFile(
        join(dir, "wrangler.toml"),
        'name = "template-app"\n',
        "utf8"
      );
      await writeFile(
        join(dir, "app", "app.rb"),
        "# full entrypoint\n",
        "utf8"
      );
      await writeFile(
        join(dir, "app", "app-simple.rb"),
        "# simple entrypoint\n",
        "utf8"
      );
    }
  })
}));

beforeAll(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "hibana-cli-e2e-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  logSpy.mockRestore();
  errorSpy.mockRestore();
  cwdSpy.mockRestore();
});

describe("CLI end-to-end", () => {
  it("プロジェクト生成後に設定が更新される", async () => {
    const { runCli } = await import("../src/index.js");
    const projectName = "sample-app";
    await runCli(["node", "create-hibana", projectName]);

    const pkg = JSON.parse(
      await readFile(join(tempRoot, projectName, "package.json"), "utf8")
    );
    const wrangler = await readFile(
      join(tempRoot, projectName, "wrangler.toml"),
      "utf8"
    );
    const fullEntrypoint = await readFile(
      join(tempRoot, projectName, "app", "app-full.rb"),
      "utf8"
    );
    const activeEntrypoint = await readFile(
      join(tempRoot, projectName, "app", "app.rb"),
      "utf8"
    );

    expect(pkg.name).toBe(projectName);
    expect(wrangler).toContain(`name = "${projectName}"`);
    expect(fullEntrypoint).toContain("# full entrypoint");
    expect(activeEntrypoint).toContain("# simple entrypoint");
  });
});
