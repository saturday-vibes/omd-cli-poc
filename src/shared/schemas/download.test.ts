import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { UsageError } from '../errors';
import { downloadSchemaPackage } from './download';

// A stand-in for npm: `install <name>@<version> --prefix <dir> ...` writes the package
// into <dir>/node_modules, counts its calls, and 404s on version 9.9.9.
function fakeNpm(dir: string): { npm: string; calls: () => number } {
  const counter = path.join(dir, 'calls');
  const npm = path.join(dir, 'npm');
  fs.writeFileSync(
    npm,
    `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const [, , , spec, , prefix] = process.argv;
fs.appendFileSync(${JSON.stringify(counter)}, 'x');
const at = spec.lastIndexOf('@');
const name = spec.slice(0, at), version = spec.slice(at + 1);
if (version === '9.9.9') { process.stderr.write('npm error code E404\\n'); process.exit(1); }
const out = path.join(prefix, 'node_modules', ...name.split('/'));
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ name, version, main: 'schema.json' }));
fs.writeFileSync(path.join(out, 'schema.json'), '{}');
`,
    { mode: 0o755 },
  );
  return { npm, calls: () => (fs.existsSync(counter) ? fs.readFileSync(counter, 'utf8').length : 0) };
}

describe('downloadSchemaPackage', () => {
  let temp: string;
  let cacheDir: string;

  beforeEach(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'download-'));
    cacheDir = path.join(temp, 'cache');
  });

  it('installs into the cache, then reuses the cached copy', async () => {
    const { npm, calls } = fakeNpm(temp);

    const dir = await downloadSchemaPackage('component', '1.5.0', { cacheDir, npm });
    expect(dir).toBe(path.join(cacheDir, 'component', '1.5.0'));
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version).toBe('1.5.0');

    await downloadSchemaPackage('component', '1.5.0', { cacheDir, npm });
    expect(calls()).toBe(1);
  });

  it('leaves no temp folders behind', async () => {
    const { npm } = fakeNpm(temp);
    await downloadSchemaPackage('service', '1.3.0', { cacheDir, npm });
    expect(fs.readdirSync(cacheDir).sort()).toEqual(['service']);
  });

  it('reports an unpublished version as a usage error', async () => {
    const { npm } = fakeNpm(temp);
    await expect(downloadSchemaPackage('component', '9.9.9', { cacheDir, npm })).rejects.toThrow(
      new UsageError('component schema 9.9.9 is not published (@test-org-th/omd-schema-component@9.9.9 not found on the registry)'),
    );
    expect(fs.readdirSync(cacheDir)).toEqual(['component']);
  });

  it('rejects anything but X.Y.Z before running npm', async () => {
    const { npm, calls } = fakeNpm(temp);
    await expect(downloadSchemaPackage('component', '1.5.0 --registry=evil', { cacheDir, npm })).rejects.toThrow(
      'Invalid schema version',
    );
    expect(calls()).toBe(0);
  });
});
