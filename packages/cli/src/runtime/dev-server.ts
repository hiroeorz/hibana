import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';

import chokidar, { FSWatcher } from 'chokidar';

interface DevServerOptions {
  port?: string;
}

type RubyBuildResult =
  | { status: 'success' }
  | { status: 'missing-bundle' }
  | { status: 'failed'; exitCode: number | null };

export const runDevServer = async (options: DevServerOptions): Promise<void> => {
  const projectRoot = process.cwd();

  await assertProjectIsScaffolded(projectRoot);
  const rubyWatcher = await startRubyBuildLoop(projectRoot);

  try {
    await runWranglerDev(projectRoot, options);
  } finally {
    if (rubyWatcher) {
      await rubyWatcher.close();
    }
  }
};

const assertProjectIsScaffolded = async (projectRoot: string): Promise<void> => {
  const wranglerToml = path.join(projectRoot, 'wrangler.toml');
  if (!(await pathExists(wranglerToml))) {
    throw new Error('No wrangler.toml found in the current directory. Run this command from a Hibana project root.');
  }
};

const runWranglerDev = (projectRoot: string, options: DevServerOptions): Promise<void> => {
  const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const args = ['wrangler', 'dev'];

  if (options.port) {
    args.push('--port', options.port);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(npxCommand, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      env: {
        ...process.env
      }
    });

    const handleSignal = (): void => {
      if (!child.killed) {
        child.kill('SIGINT');
      }
    };

    process.once('SIGINT', handleSignal);
    process.once('SIGTERM', handleSignal);

    child.on('error', (error) => {
      cleanup();
      reject(error);
    });

    child.on('close', (code, signal) => {
      cleanup();
      if (signal) {
        resolve();
        return;
      }
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`wrangler dev exited with code ${code}`));
      }
    });

    const cleanup = (): void => {
      process.removeListener('SIGINT', handleSignal);
      process.removeListener('SIGTERM', handleSignal);
    };
  });
};

const startRubyBuildLoop = async (projectRoot: string): Promise<FSWatcher | null> => {
  const rakefilePath = path.join(projectRoot, 'Rakefile');
  if (!(await pathExists(rakefilePath))) {
    console.warn('Skipping Ruby WASM rebuilds because no Rakefile was found.');
    return null;
  }

  const builder = new RubyBuilder(projectRoot);
  await builder.run('initial');

  const watcher = chokidar.watch(['app/**/*.rb', 'lib/**/*.rb'], {
    cwd: projectRoot,
    ignoreInitial: true
  });

  watcher.on('all', (eventName, filePath) => {
    builder.schedule(`${eventName} ${filePath}`);
  });

  watcher.on('error', (error) => {
    console.error('File watcher error:', error);
  });

  return watcher;
};

class RubyBuilder {
  private running = false;
  private queuedReason: string | null = null;
  private disabled = false;

  constructor(private readonly projectRoot: string) {}

  public async run(reason: string): Promise<void> {
    if (this.disabled) {
      return;
    }

    this.running = true;
    try {
      await this.execute(reason);
    } finally {
      this.running = false;
      if (this.queuedReason) {
        const nextReason = this.queuedReason;
        this.queuedReason = null;
        await this.run(nextReason);
      }
    }
  }

  public schedule(reason: string): void {
    if (this.disabled) {
      return;
    }

    if (this.running) {
      this.queuedReason = reason;
      return;
    }

    void this.run(reason);
  }

  private async execute(reason: string): Promise<void> {
    console.log(`Rebuilding Ruby WASM bundle (trigger: ${reason})`);
    const result = await runBundleRakeTask(this.projectRoot);

    if (result.status === 'success') {
      console.log('Ruby WASM build completed.');
      return;
    }

    if (result.status === 'missing-bundle') {
      console.warn('Could not find the `bundle` executable. Install Bundler and run bundle install to enable auto builds.');
      this.disabled = true;
      return;
    }

    console.warn(
      `Ruby build failed${result.exitCode !== null ? ` with exit code ${result.exitCode}` : ''}. Fix the issue and save again to retry.`
    );
  }
}

const runBundleRakeTask = (projectRoot: string): Promise<RubyBuildResult> => {
  const bundleCommand = process.platform === 'win32' ? 'bundle.cmd' : 'bundle';
  const args = ['exec', 'rake', 'wasm:build'];

  return new Promise((resolve) => {
    const child = spawn(bundleCommand, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      env: {
        ...process.env
      }
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        resolve({ status: 'missing-bundle' });
      } else {
        console.error('Failed to run Bundler:', error);
        resolve({ status: 'failed', exitCode: null });
      }
    });

    child.on('close', (code, signal) => {
      if (signal) {
        resolve({ status: 'failed', exitCode: null });
      } else if (code === 0) {
        resolve({ status: 'success' });
      } else {
        resolve({ status: 'failed', exitCode: code ?? null });
      }
    });
  });
};

const pathExists = async (target: string): Promise<boolean> => {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch (error) {
    if (isEnoent(error)) {
      return false;
    }
    throw error;
  }
};

const isEnoent = (error: unknown): error is NodeJS.ErrnoException => {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT');
};
