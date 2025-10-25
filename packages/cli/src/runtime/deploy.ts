import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';

import { runBundleBuild } from './bundle.js';

interface DeployOptions {
  dryRun?: boolean;
  skipRubyBuild?: boolean;
  skipAssetsBuild?: boolean;
  wranglerArgs?: string[];
  projectRoot?: string;
}

export const runDeploy = async (options: DeployOptions): Promise<void> => {
  const projectRoot = options.projectRoot ?? process.cwd();

  await ensureProjectIsValid(projectRoot, options);

  if (!options.skipRubyBuild) {
    await runRubyBuild(projectRoot);
  } else {
    console.log('Skipping Ruby WASM build (per --skip-ruby-build).');
  }

  if (!options.skipAssetsBuild) {
    await runAssetsBuild(projectRoot);
  } else {
    console.log('Skipping npm build step (per --skip-assets-build).');
  }

  await runWranglerDeploy(projectRoot, {
    dryRun: options.dryRun,
    wranglerArgs: options.wranglerArgs ?? []
  });
};

const ensureProjectIsValid = async (projectRoot: string, options: DeployOptions): Promise<void> => {
  await assertPathExists(
    path.join(projectRoot, 'wrangler.toml'),
    'wrangler.toml not found. Run this command from a Hibana project root.'
  );

  if (!options.skipRubyBuild) {
    await assertPathExists(
      path.join(projectRoot, 'Rakefile'),
      'Rakefile not found. Hibana deploy expects bundle exec rake wasm:build to be available.'
    );
  }
};

const assertPathExists = async (target: string, message: string): Promise<void> => {
  try {
    await access(target, constants.F_OK);
  } catch (error: unknown) {
    if (isEnoent(error)) {
      throw new Error(message);
    }
    throw error;
  }
};

const runRubyBuild = async (projectRoot: string): Promise<void> => {
  console.log('Building Ruby WASM bundle...');
  const result = await runBundleBuild(projectRoot);

  if (result.status === 'success') {
    console.log('Ruby WASM build completed.');
    return;
  }

  if (result.status === 'missing-bundle') {
    throw new Error('Could not find the `bundle` executable. Install Bundler and run bundle install before deploying.');
  }

  const exitInfo = result.exitCode !== null ? ` (exit code ${result.exitCode})` : '';
  throw new Error(`Ruby WASM build failed${exitInfo}. Fix the issues and retry.`);
};

const runAssetsBuild = async (projectRoot: string): Promise<void> => {
  console.log('Running npm build script...');
  await executeCommand(npmCommand(), ['run', 'build'], projectRoot, 'npm run build failed.');
};

const runWranglerDeploy = async (
  projectRoot: string,
  options: { dryRun?: boolean; wranglerArgs: string[] }
): Promise<void> => {
  const args = ['wrangler', 'deploy'];

  const wranglerArgs = options.wranglerArgs ?? [];
  if (options.dryRun && !hasDryRunArgument(wranglerArgs)) {
    args.push('--dry-run');
  }

  if (wranglerArgs.length > 0) {
    args.push(...wranglerArgs);
  }

  await executeCommand(npxCommand(), args, projectRoot, 'wrangler deploy failed.');
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

const hasDryRunArgument = (args: string[]): boolean => {
  return args.some((arg) => arg === '--dry-run');
};

const npmCommand = (): string => (process.platform === 'win32' ? 'npm.cmd' : 'npm');
const npxCommand = (): string => (process.platform === 'win32' ? 'npx.cmd' : 'npx');

const isEnoent = (error: unknown): error is NodeJS.ErrnoException => {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT');
};
