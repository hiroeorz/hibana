import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CreateProjectOptions {
  projectName: string;
  templateName: string;
  cwd?: string;
}

export interface CreateProjectResult {
  targetDir: string;
  metadata: {
    projectName: string;
    packageName: string;
    moduleName: string;
    compatibilityDate: string;
  };
}

export class ScaffoldError extends Error {}

const templateRoots = [
  '../../templates', // When executing from src via tsx
  '../templates' // When running from compiled dist
];

const TEMPLATE_PLACEHOLDER = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;

export const createProject = async (options: CreateProjectOptions): Promise<CreateProjectResult> => {
  const cwd = options.cwd ?? process.cwd();
  const projectName = options.projectName.trim();

  if (projectName.length === 0) {
    throw new ScaffoldError('Project name must not be empty.');
  }

  const packageName = toKebabCase(projectName);
  if (packageName.length === 0) {
    throw new ScaffoldError('Project name must include at least one alphanumeric character.');
  }

  const moduleName = toPascalCase(projectName);
  const compatibilityDate = new Date().toISOString().slice(0, 10);

  const targetDir = path.resolve(cwd, projectName);
  const templateDir = await resolveTemplateDir(options.templateName);

  await ensureTargetDoesNotExist(targetDir);
  await mkdir(targetDir, { recursive: true });

  const metadata = { projectName, packageName, moduleName, compatibilityDate };
  await copyTemplate(templateDir, targetDir, metadata);

  return { targetDir, metadata };
};

const resolveTemplateDir = async (templateName: string): Promise<string> => {
  const moduleDir =
    typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

  for (const candidate of templateRoots) {
    const templatePath = path.resolve(moduleDir, candidate, templateName);
    try {
      const stats = await stat(templatePath);
      if (stats.isDirectory()) {
        return templatePath;
      }
    } catch (error: unknown) {
      if (isMissingFileError(error)) {
        continue;
      }
      throw error;
    }
  }

  throw new ScaffoldError(`Unknown template "${templateName}".`);
};

const ensureTargetDoesNotExist = async (targetDir: string): Promise<void> => {
  try {
    await stat(targetDir);
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return;
    }
    throw error;
  }

  throw new ScaffoldError(`Directory already exists at ${path.relative(process.cwd(), targetDir)}.`);
};

const copyTemplate = async (
  templateDir: string,
  targetDir: string,
  context: Record<string, string>
): Promise<void> => {
  const entries = await readdir(templateDir, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const templatePath = path.join(templateDir, entry.name);
      const outputName = entry.name.endsWith('.template')
        ? entry.name.replace(/\.template$/, '')
        : entry.name;
      const outputPath = path.join(targetDir, outputName);

      if (entry.isDirectory()) {
        await mkdir(outputPath, { recursive: true });
        await copyTemplate(templatePath, outputPath, context);
        return;
      }

      const contents = await readFile(templatePath, 'utf8');
      const rendered = renderTemplate(contents, context);
      await writeFile(outputPath, rendered, 'utf8');
    })
  );
};

const renderTemplate = (contents: string, context: Record<string, string>): string => {
  return contents.replace(TEMPLATE_PLACEHOLDER, (_, key: string) => context[key] ?? '');
};

const isMissingFileError = (error: unknown): error is NodeJS.ErrnoException => {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT');
};

const toKebabCase = (value: string): string => {
  const slug = value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug;
};

const toPascalCase = (value: string): string => {
  const segments = value
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);

  if (segments.length === 0) {
    return 'App';
  }

  return segments.map(capitalize).join('');
};

const capitalize = (segment: string): string => {
  const lower = segment.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};
