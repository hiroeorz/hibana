import { mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { createProject, ScaffoldError } from '../src/scaffold/create-project.js';

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

    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageJson = await readFile(packageJsonPath, 'utf8');
    const packageData = JSON.parse(packageJson) as Record<string, unknown>;

    expect(packageData.name).toBe('example-app');
    expect(packageData.dependencies).toMatchObject({
      '@ruby/wasm-wasi': expect.any(String)
    });
    expect(packageData.devDependencies).toMatchObject({
      '@hibana/cli': 'file:../packages/cli',
      '@ruby/3.4-wasm-wasi': expect.any(String),
      wrangler: expect.any(String)
    });

    const appRb = await readFile(path.join(projectPath, 'app', 'app.rb'), 'utf8');
    expect(appRb).toContain("require 'hibana'");
    expect(appRb).toContain('module Hibana');
    expect(appRb).toContain('ENTRYPOINT = Hibana.app');

    const wrangler = await readFile(path.join(projectPath, 'wrangler.toml'), 'utf8');
    expect(wrangler).toContain(`compatibility_date = "${result.metadata.compatibilityDate}"`);

    const gitignore = await readFile(path.join(projectPath, '.gitignore'), 'utf8');
    expect(gitignore).toContain('/node_modules');

    const rakefile = await readFile(path.join(projectPath, 'Rakefile'), 'utf8');
    expect(rakefile).toContain("require_relative 'lib/hibana/wasm/builder'");

    const builder = await readFile(path.join(projectPath, 'lib', 'hibana', 'wasm', 'builder.rb'), 'utf8');
    expect(builder).toContain('module Hibana');

    const tsconfig = await readFile(path.join(projectPath, 'tsconfig.json'), 'utf8');
    expect(tsconfig).toContain('"src/**/*.d.ts"');

    await expect(readFile(path.join(projectPath, 'src', 'types', 'wasm.d.ts'), 'utf8')).resolves.toContain('declare module');
    await expect(readFile(path.join(projectPath, 'src', 'types', 'json.d.ts'), 'utf8')).resolves.toContain('declare module');

    const gemfile = await readFile(path.join(projectPath, 'Gemfile'), 'utf8');
    expect(gemfile).toContain("gem 'base64'");
  });

  it('normalizes package and module names from mixed input', async () => {
    const result = await createProject({
      projectName: '  My Fancy_App ',
      templateName: 'default',
      cwd: tempRoot
    });

    expect(result.metadata.projectName).toBe('My Fancy_App');
    expect(result.metadata.packageName).toBe('my-fancy-app');
    expect(result.metadata.moduleName).toBe('MyFancyApp');

    const generated = await readFile(path.join(result.targetDir, 'package.json'), 'utf8');
    const parsed = JSON.parse(generated) as Record<string, unknown>;
    expect(parsed.name).toBe('my-fancy-app');

    const readme = await readFile(path.join(result.targetDir, 'README.md'), 'utf8');
    expect(readme).toContain('# My Fancy_App');
  });

  it('fails when the target directory already exists', async () => {
    const existingName = 'existing-app';
    const existingPath = path.join(tempRoot, existingName);
    await mkdir(existingPath, { recursive: true });

    await expect(
      createProject({
        projectName: existingName,
        templateName: 'default',
        cwd: tempRoot
      })
    ).rejects.toThrow('Directory already exists');
  });

  it('fails when the template does not exist', async () => {
    await expect(
      createProject({
        projectName: 'missing-template',
        templateName: 'does-not-exist',
        cwd: tempRoot
      })
    ).rejects.toBeInstanceOf(ScaffoldError);
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
