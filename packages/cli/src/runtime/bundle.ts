import { spawn } from 'node:child_process';

export type RubyBuildResult =
  | { status: 'success' }
  | { status: 'missing-bundle' }
  | { status: 'failed'; exitCode: number | null };

export const runBundleBuild = (
  projectRoot: string,
  options: { env?: NodeJS.ProcessEnv } = {}
): Promise<RubyBuildResult> => {
  const bundleCommand = process.platform === 'win32' ? 'bundle.cmd' : 'bundle';
  const args = ['exec', 'rake', 'wasm:build'];
  const spawnOptions = {
    cwd: projectRoot,
    stdio: 'inherit' as const,
    env: {
      ...process.env,
      ...(options.env ?? {})
    }
  };

  return new Promise((resolve) => {
    const child = spawn(bundleCommand, args, spawnOptions);

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
