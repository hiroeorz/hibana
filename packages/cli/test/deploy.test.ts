import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/runtime/bundle.js', () => ({
  runBundleBuild: vi.fn()
}));

const { runBundleBuild } = await import('../src/runtime/bundle.js');
const runBundleBuildMock = vi.mocked(runBundleBuild);

const spawnMock = vi.fn();

class MockChildProcess extends EventEmitter {
  public kill = vi.fn();
}

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: spawnMock
  };
});

const { runDeploy } = await import('../src/runtime/deploy.js');

const createProjectFixture = async ({
  includeRakefile
}: {
  includeRakefile: boolean;
}): Promise<string> => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hibana-deploy-'));
  await writeFile(path.join(tempDir, 'wrangler.toml'), 'name = "test"\nmain = "src/index.ts"\n');
  if (includeRakefile) {
    await writeFile(path.join(tempDir, 'Rakefile'), "task default: 'wasm:build'\n");
  }
  return tempDir;
};

beforeEach(() => {
  spawnMock.mockImplementation((command: string, args: string[]) => {
    const child = new MockChildProcess();
    const cmd = command.toLowerCase();

    if (cmd.includes('npm')) {
      setImmediate(() => {
        child.emit('close', 0, null);
      });
    } else if (cmd.includes('npx')) {
      setImmediate(() => {
        child.emit('close', 0, null);
      });
    } else {
      setImmediate(() => {
        child.emit('close', 0, null);
      });
    }

    return child;
  });

  runBundleBuildMock.mockReset();
  runBundleBuildMock.mockResolvedValue({ status: 'success' });
});

afterEach(async () => {
  spawnMock.mockReset();
});

describe('runDeploy', () => {
  it('builds Ruby, runs npm build, and deploys via wrangler', async () => {
    const projectRoot = await createProjectFixture({ includeRakefile: true });

    await runDeploy({
      projectRoot,
      wranglerArgs: ['--env', 'production']
    });

    expect(runBundleBuildMock).toHaveBeenCalledWith(projectRoot);

    const npmCall = spawnMock.mock.calls.find(([command]) => (command as string).toLowerCase().includes('npm'));
    expect(npmCall).toBeDefined();
    expect(npmCall?.[1]).toEqual(['run', 'build']);

    const wranglerCall = spawnMock.mock.calls.find(([command, args]) => {
      return (command as string).toLowerCase().includes('npx') && Array.isArray(args) && args[0] === 'wrangler';
    });
    expect(wranglerCall).toBeDefined();
    expect(wranglerCall?.[1]).toEqual(['wrangler', 'deploy', '--env', 'production']);

    await rm(projectRoot, { recursive: true, force: true });
  });

  it('skips the Ruby build when requested', async () => {
    const projectRoot = await createProjectFixture({ includeRakefile: false });

    await runDeploy({
      projectRoot,
      skipRubyBuild: true,
      skipAssetsBuild: true
    });

    expect(runBundleBuildMock).not.toHaveBeenCalled();

    await rm(projectRoot, { recursive: true, force: true });
  });

  it('adds --dry-run when requested', async () => {
    const projectRoot = await createProjectFixture({ includeRakefile: true });

    await runDeploy({
      projectRoot,
      dryRun: true
    });

    const wranglerCall = spawnMock.mock.calls.find(([command, args]) => {
      return (command as string).toLowerCase().includes('npx') && Array.isArray(args) && args[0] === 'wrangler';
    });

    expect(wranglerCall?.[1]).toContain('--dry-run');

    await rm(projectRoot, { recursive: true, force: true });
  });

  it('throws when Ruby build fails', async () => {
    const projectRoot = await createProjectFixture({ includeRakefile: true });
    runBundleBuildMock.mockResolvedValue({ status: 'failed', exitCode: 1 });

    await expect(
      runDeploy({
        projectRoot
      })
    ).rejects.toThrow(/Ruby WASM build failed/);

    await rm(projectRoot, { recursive: true, force: true });
  });

  it('throws when npm build fails', async () => {
    const projectRoot = await createProjectFixture({ includeRakefile: true });
    runBundleBuildMock.mockResolvedValue({ status: 'success' });

    spawnMock.mockImplementation((command: string, args: string[]) => {
      const child = new MockChildProcess();
      const cmd = command.toLowerCase();

      if (cmd.includes('npm')) {
        setImmediate(() => {
          child.emit('close', 1, null);
        });
      } else {
        setImmediate(() => {
          child.emit('close', 0, null);
        });
      }

      return child;
    });

    await expect(
      runDeploy({
        projectRoot
      })
    ).rejects.toThrow(/npm run build failed/);

    await rm(projectRoot, { recursive: true, force: true });
  });
});
