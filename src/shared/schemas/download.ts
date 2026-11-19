import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { UsageError } from '../errors';
import type { SchemaKind } from './kinds';
import { packageName } from './kinds';

const execFileAsync = promisify(execFile);

export type DownloadOptions = {
  /** Defaults to `$OMD_CACHE_DIR`, else `~/.omd-cli/schemas`. */
  cacheDir?: string;
  /** npm runs here so the user's project `.npmrc` (registry, auth) applies. */
  cwd?: string;
  npm?: string;
};

export function defaultCacheDir(): string {
  return process.env.OMD_CACHE_DIR ?? path.join(os.homedir(), '.omd-cli', 'schemas');
}

/**
 * Installs `@test-org-th/omd-schema-<kind>@<version>` into the cache and returns its folder.
 * A cached copy is reused. npm runs with `--ignore-scripts` and only writes to the cache.
 */
export async function downloadSchemaPackage(kind: SchemaKind, version: string, options: DownloadOptions = {}): Promise<string> {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new UsageError(`Invalid schema version: ${version}`);
  }
  const cacheDir = options.cacheDir ?? defaultCacheDir();
  const target = path.join(cacheDir, kind, version);
  if (fs.existsSync(path.join(target, 'package.json'))) {
    return target;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = fs.mkdtempSync(path.join(cacheDir, '.tmp-'));
  const spec = `${packageName(kind)}@${version}`;
  try {
    await execFileAsync(
      options.npm ?? 'npm',
      ['install', spec, '--prefix', temp, '--ignore-scripts', '--no-save', '--no-package-lock', '--no-audit', '--no-fund'],
      { cwd: options.cwd ?? process.cwd(), timeout: 120_000 },
    );
  } catch (error) {
    fs.rmSync(temp, { recursive: true, force: true });
    const output = `${(error as { stderr?: string }).stderr ?? ''}`;
    if (output.includes('E404') || output.includes('ETARGET')) {
      throw new UsageError(`${kind} schema ${version} is not published (${spec} not found on the registry)`);
    }
    throw new Error(`Downloading ${spec} failed: ${output.trim().split('\n').slice(-3).join(' ') || (error as Error).message}`);
  }

  const installed = path.join(temp, 'node_modules', ...packageName(kind).split('/'));
  try {
    fs.renameSync(installed, target);
  } catch (error) {
    // Another run finished the same download first; its copy is as good as ours.
    if (!fs.existsSync(path.join(target, 'package.json'))) throw error;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  return target;
}
