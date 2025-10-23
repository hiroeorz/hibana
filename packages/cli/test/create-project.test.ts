import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { createProject } from '../src/scaffold/create-project.js';

const tempRoot = await rmTempDirOnExit();

describe('createProject', () => {
  it('creates a project from the default template with placeholder substitution', async () => {
    const result = await createProject({
      projectName: 'example-app',
      templateName: 'default',
      cwd: tempRoot
    });

    const projectPath = path.join(tempRoot, 'example-app');
    expect(result.targetDir).toBe(projectPath);

    const packageJson = await readFile(path.join(projectPath, 'package.json'), 'utf8');
    expect(packageJson).toContain('"name": "example-app"');

    const appRb = await readFile(path.join(projectPath, 'app', 'app.rb'), 'utf8');
    expect(appRb).toContain('class ExampleApp');

    const wrangler = await readFile(path.join(projectPath, 'wrangler.toml'), 'utf8');
    expect(wrangler).toContain(`compatibility_date = "${result.metadata.compatibilityDate}"`);

    const gitignore = await readFile(path.join(projectPath, '.gitignore'), 'utf8');
    expect(gitignore).toContain('/node_modules');
  });
});

async function createTempDir(): Promise<string> {
  const prefix = path.join(os.tmpdir(), 'hibana-');
  // Use fs.mkdtemp via dynamic import because vitest runs in ESM mode.
  const { mkdtemp } = await import('node:fs/promises');
  return mkdtemp(prefix);
}

async function rmTempDirOnExit(): Promise<string> {
  const tempDir = await createTempDir();

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  return tempDir;
}
