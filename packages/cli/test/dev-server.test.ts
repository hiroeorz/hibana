import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();

class MockChildProcess extends EventEmitter {
  public kill = vi.fn();
}

let latestWranglerChild: MockChildProcess | null = null;

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}));

const chokidarWatchers: Array<{
  on: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  __emit: (event: string, ...args: unknown[]) => void;
}> = [];

const watchMock = vi.fn(() => {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

  const watcher = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      (listeners[event] ||= []).push(handler);
      return watcher;
    }),
    close: vi.fn(async () => {}),
    __emit: (event: string, ...args: unknown[]) => {
      for (const handler of listeners[event] ?? []) {
        handler(...args);
      }
    }
  };

  chokidarWatchers.push(watcher);
  return watcher;
});

vi.mock('chokidar', () => ({
  __esModule: true,
  default: { watch: watchMock },
  watch: watchMock,
  __watchers: chokidarWatchers
}));

const chokidarModule = await import('chokidar');

const { runDevServer } = await import('../src/runtime/dev-server.js');

const getWatchers = (): typeof chokidarWatchers => (chokidarModule as unknown as { __watchers: typeof chokidarWatchers }).__watchers;

beforeEach(() => {
  latestWranglerChild = null;

  spawnMock.mockImplementation((command: string, args: string[]) => {
    const child = new MockChildProcess();
    const cmd = command.toLowerCase();

    if (cmd.includes('bundle')) {
      setImmediate(() => {
        child.emit('close', 0, null);
      });
    } else if (args[0] === 'wrangler' && args[1] === 'dev') {
      // Leave wrangler running until the test finishes.
      latestWranglerChild = child;
    } else {
      setImmediate(() => {
        child.emit('close', 0, null);
      });
    }

    return child;
  });

  chokidarWatchers.length = 0;
  watchMock.mockClear();
});

afterEach(async () => {
  spawnMock.mockReset();
});

const createProjectFixture = async (): Promise<string> => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hibana-dev-'));
  await writeFile(path.join(tempDir, 'wrangler.toml'), 'name = "test"\nmain = "src/index.ts"\n');
  await writeFile(path.join(tempDir, 'Rakefile'), "task default: 'wasm:build'\n");
  return tempDir;
};

describe('runDevServer', () => {
  it('forwards Wrangler args and rebuilds Ruby bundle on file changes', async () => {
    const projectDir = await createProjectFixture();

    let wranglerClosed = false;
    const closeWrangler = (): void => {
      if (!wranglerClosed && latestWranglerChild) {
        latestWranglerChild.emit('close', 0, null);
        wranglerClosed = true;
      }
    };

    const devPromise = runDevServer({
      port: '3000',
      wranglerArgs: ['--inspect', '--port', '4242'],
      projectRoot: projectDir
    });

    try {
      await vi.waitFor(() => {
        expect(watchMock).toHaveBeenCalled();
      });

      const watchers = getWatchers();
      expect(watchers).toHaveLength(1);

      const watcher = watchers[0];
      const watchPatterns = watchMock.mock.calls[0][0] as string[];
      expect(watchPatterns).toEqual(expect.arrayContaining(['app/**/*.rb', 'lib/**/*.rb', 'config/**/*.rb']));

      watcher.__emit('all', 'change', 'app/example.rb');

      await vi.waitFor(() => {
        const bundleSpawns = spawnMock.mock.calls.filter(([command]) => (command as string).includes('bundle'));
        expect(bundleSpawns).toHaveLength(2);
      });

      const wranglerCall = spawnMock.mock.calls.find(([, args]) => Array.isArray(args) && args[0] === 'wrangler');
      expect(wranglerCall).toBeDefined();
      const wranglerArgs = wranglerCall?.[1] as string[];
      expect(wranglerArgs).toContain('--inspect');
      expect(wranglerArgs).toContain('4242');
      expect(wranglerArgs.filter((arg) => arg === '--port')).toHaveLength(1);
      expect(wranglerArgs).not.toContain('3000');

      closeWrangler();
      await devPromise;
      expect(watcher.close).toHaveBeenCalled();
    } finally {
      closeWrangler();
      await devPromise.catch(() => {});
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('throws when not executed inside a Hibana project', async () => {
    const emptyDir = await mkdtemp(path.join(os.tmpdir(), 'hibana-dev-missing-'));

    try {
      await expect(
        runDevServer({
          wranglerArgs: [],
          projectRoot: emptyDir
        })
      ).rejects.toThrow(/No wrangler\.toml/);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});

afterEach(async () => {
  const watchers = getWatchers();
  watchers.length = 0;
});
