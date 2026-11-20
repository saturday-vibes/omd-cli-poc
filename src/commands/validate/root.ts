import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';
import type { LeafSpec } from '../../shared/command';
import { UsageError } from '../../shared/errors';
import { ExitCode, renderJson } from '../../shared/outcome';
import { BackstageClient } from '../../shared/backstage';
import { SchemaCatalog } from '../../shared/schemas/catalog';
import type { SchemaKind } from '../../shared/schemas/kinds';
import { backstageUrlOption, noDownloadOption, repoOption, skipBackstageOption } from '../schema/options';
import type { RuleContext } from './rules';
import { compileDocument, ignoredKeywords, validationOutcome } from './rules';

type Flags = { download: boolean; skipBackstage?: boolean; repo?: string; backstageUrl?: string };

type SchemaError = { path: string; message: string };

type FileResult = {
  ok: boolean;
  file: string;
  kind?: SchemaKind;
  schemaVersion?: string;
  source?: 'bundled' | 'downloaded';
  backstage: 'checked' | 'skipped';
  errors: SchemaError[];
};

const MISSING_BACKSTAGE = `Backstage checks need OMD_BACKSTAGE_URL and OMD_BACKSTAGE_SECRET.
Pass --backstage-url to set the URL for one run.
Pass --skip-backstage to run the schema checks only.`;

export const validateCommand: LeafSpec<Flags> = {
  name: 'validate',
  description: 'Validate a repository .omd folder, or one now.yaml, including the action Backstage rules.',
  arguments: ['[path]'],
  options: () => [noDownloadOption(), skipBackstageOption(), repoOption(), backstageUrlOption()],
  run: async ({ args: [target = process.cwd()], download, skipBackstage, repo, backstageUrl, format }) => {
    if (!fs.existsSync(target)) {
      throw new UsageError(`No such file: ${target}`);
    }
    const directory = fs.statSync(target).isDirectory();
    if (directory) omdFiles(target);
    const ctx = ruleContext({ skipBackstage, repo, backstageUrl }, target);
    if (directory) {
      const files = await validateRepo(target, download, ctx);
      return render(files, format, true);
    }
    return render([await validateNowYaml(target, download, ctx)], format, false);
  },
};

/**
 * `.omd/now.yaml`, then each direct component folder's `now.yaml`.
 * The path is the repository root, as in action-validate-now-dot-yaml.
 */
export function omdFiles(root: string): string[] {
  const omdDir = path.join(root, '.omd');
  if (!fs.existsSync(omdDir) || !fs.statSync(omdDir).isDirectory()) {
    throw new UsageError(`missing .omd folder at ${omdDir}`);
  }
  const service = path.join(omdDir, 'now.yaml');
  if (!fs.existsSync(service)) {
    throw new UsageError(`missing now.yaml at ${service}`);
  }
  const components = fs
    .readdirSync(omdDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map(name => path.join(omdDir, name, 'now.yaml'));
  return [service, ...components];
}

function ruleContext(flags: { skipBackstage?: boolean; repo?: string; backstageUrl?: string }, start: string): RuleContext {
  const directory = fs.statSync(start).isDirectory() ? start : path.dirname(start);
  const repository = flags.repo || detectRepository(directory);
  const componentNames = componentFolders(start);
  if (flags.skipBackstage) {
    return { skipBackstage: true, repository, componentNames };
  }
  const url = flags.backstageUrl || process.env.OMD_BACKSTAGE_URL;
  const secret = process.env.OMD_BACKSTAGE_SECRET;
  if (!url || !secret) throw new UsageError(MISSING_BACKSTAGE);
  return {
    skipBackstage: false,
    repository,
    componentNames,
    client: new BackstageClient({ url, secret }),
  };
}

async function validateRepo(root: string, download: boolean, ctx: RuleContext): Promise<FileResult[]> {
  const results: FileResult[] = [];
  for (const file of omdFiles(root)) {
    const label = path.relative(root, file).split(path.sep).join('/');
    try {
      results.push(await validateNowYaml(file, download, ctx, { label, folderName: componentFolder(label) }));
    } catch (error) {
      if (!(error instanceof UsageError)) throw error;
      results.push({ ok: false, file: label, backstage: ctx.skipBackstage ? 'skipped' : 'checked', errors: [{ path: '/', message: error.message }] });
    }
  }
  return results;
}

/** `.omd/<component>/now.yaml` → `<component>`. The service file has none. */
function componentFolder(label: string): string | undefined {
  const parent = path.posix.dirname(label);
  if (parent === '.omd') return undefined;
  return path.posix.basename(parent);
}

async function validateNowYaml(
  file: string,
  download: boolean,
  ctx: RuleContext,
  options: { label?: string; folderName?: string } = {},
): Promise<FileResult> {
  const label = options.label ?? file;
  if (!fs.existsSync(file)) {
    throw new UsageError(`missing now.yaml at ${label}`);
  }
  const document = yaml.load(fs.readFileSync(file, 'utf8')) as Record<string, unknown> | null;
  if (!document || typeof document !== 'object') {
    throw new UsageError(`${label} is not a YAML mapping`);
  }
  const kind: SchemaKind = 'omd_component' in document ? 'component' : 'service';
  const declared = document.schema_version ?? document.omd_schema_version;
  if (typeof declared !== 'string') {
    throw new UsageError(`${label} has no schema_version`);
  }

  const loaded = await new SchemaCatalog().resolve(kind, declared, { download });
  const ignored = ignoredKeywords(document, kind, declared, file, ctx.skipBackstage);
  const validate = compileDocument(loaded.schema, ignored, ctx);
  const outcome = await validationOutcome(validate, document);
  const errors: SchemaError[] = outcome.errors.map(error => ({
    path: error.instancePath || '/',
    message: error.message ?? error.keyword,
  }));
  const folderError = folderNameError(document, options.folderName);
  if (folderError) errors.push(folderError);
  return {
    ok: outcome.valid && !folderError,
    file: label,
    kind,
    schemaVersion: `v${loaded.version}`,
    source: loaded.source,
    backstage: ctx.skipBackstage ? 'skipped' : 'checked',
    errors,
  };
}

/** The action requires `.omd/<component>/` to match `omd_component.name`. */
function folderNameError(document: Record<string, unknown>, folderName: string | undefined): SchemaError | undefined {
  if (!folderName) return undefined;
  const component = document.omd_component;
  const name =
    component && typeof component === 'object' && 'name' in component
      ? (component as { name?: unknown }).name
      : undefined;
  if (typeof name !== 'string' || name === folderName) return undefined;
  return {
    path: '/omd_component/name',
    message: `The folder name, ${folderName}, does not align with the specified OMD component name, ${name}`,
  };
}

function componentFolders(start: string): string[] {
  const omdDir = findOmd(start);
  if (!omdDir) return [];
  return fs
    .readdirSync(omdDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);
}

/** The repo root, the `.omd` folder, or a `now.yaml` one or two levels under it. */
function findOmd(start: string): string | undefined {
  let dir = fs.statSync(start).isDirectory() ? start : path.dirname(start);
  for (let hop = 0; hop < 3; hop++) {
    if (path.basename(dir) === '.omd') return dir;
    const nested = path.join(dir, '.omd');
    if (fs.existsSync(nested) && fs.statSync(nested).isDirectory()) return nested;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

const GITHUB_REMOTE = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/;

function detectRepository(root: string): string | undefined {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const url = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const match = GITHUB_REMOTE.exec(url);
    return match ? `${match[1]}/${match[2]}` : undefined;
  } catch {
    return undefined;
  }
}

function render(results: FileResult[], format: 'json' | 'text', repo: boolean) {
  const ok = results.every(result => result.ok);
  const exitCode = ok ? ExitCode.Ok : ExitCode.Invalid;
  if (format === 'json') {
    const body = repo ? { ok, files: results } : results[0];
    return { exitCode, stdout: renderJson(body), stderr: '' };
  }
  return { exitCode, stdout: `${textLines(results).join('\n')}\n`, stderr: '' };
}

function textLines(results: FileResult[]): string[] {
  const lines: string[] = [];
  for (const result of results) {
    if (!result.kind) {
      lines.push(result.errors.map(error => error.message).join('\n'));
      continue;
    }
    const summary = result.ok ? 'valid' : `${result.errors.length} error(s)`;
    const backstage = result.backstage === 'checked' ? 'backstage checked' : 'backstage skipped';
    lines.push(`${result.file}: ${summary} against ${result.kind} schema ${result.schemaVersion} (${result.source}, ${backstage})`);
    for (const error of result.errors) lines.push(`  ${error.path} ${error.message}`);
  }
  return lines;
}
