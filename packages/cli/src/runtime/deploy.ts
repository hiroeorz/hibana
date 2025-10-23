import { spawn } from 'node:child_process';
import path from 'node:path';

interface DeployOptions {
  dryRun?: boolean;
}

export const runDeploy = async (options: DeployOptions): Promise<void> => {
  const projectRoot = process.cwd();

  await ensureProjectIsValid(projectRoot);
  await runRubyBuild(projectRoot);
  await runWranglerDeploy(projectRoot, options);
};

const ensureProjectIsValid = async (projectRoot: string): Promise<void> => {
  await assertPathExists(path.join(projectRoot, 'wrangler.toml'), 'wrangler.toml not found. Run this command from a Hibana project root.');
};

const assertPathExists = async (target: string, message: string): Promise<void> => {
  try {
    await import('node:fs/promises').then(({ access, constants }) => access(target, constants.F_OK));
  } catch (error: unknown) {
    if (isEnoent(error)) {
      throw new Error(message);
    }
    throw error;
  }
};

const runRubyBuild = async (projectRoot: string): Promise<void> => {
  await executeCommand(bundleCommand(), ['exec', 'rake', 'wasm:build'], projectRoot, 'bundle exec rake wasm:build failed');
};

const runWranglerDeploy = async (projectRoot: string, options: DeployOptions): Promise<void> => {
  const args = ['wrangler', 'deploy'];
  if (options.dryRun) {
    args.push('--dry-run');
  }

  await executeCommand(npxCommand(), args, projectRoot, 'wrangler deploy failed');
};

const executeCommand = (command: string, args: string[], cwd: string, errorMessage: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env
      }
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (signal) {
        reject(new Error(`${errorMessage} (received signal ${signal})`));
        return;
      }

      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${errorMessage} (exit code ${code})`));
      }
    });
  });
};

const bundleCommand = (): string => (process.platform === 'win32' ? 'bundle.cmd' : 'bundle');
const npxCommand = (): string => (process.platform === 'win32' ? 'npx.cmd' : 'npx');

const isEnoent = (error: unknown): error is NodeJS.ErrnoException => {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT');
};
