import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runCli } from './program';
import { cliPackage } from './shared/package';

const fixtures = path.join(__dirname, '..', 'test', 'fixtures');
const repo = path.join(__dirname, '..', 'test', 'repos', 'service-catalog-backstage');
const run = (...args: string[]) => runCli(['node', 'omd', ...args]);

describe('omd', () => {
  it('prints its version', async () => {
    expect(await run('--version')).toMatchObject({ exitCode: 0, stdout: `${cliPackage().version}\n` });
  });

  it('lists bundled versions', async () => {
    const outcome = await run('schema', 'versions');
    const result = JSON.parse(outcome.stdout);
    expect(result.component.package).toBe('@test-org-th/omd-schema-component');
    expect(result.component.versions.length).toBeGreaterThan(0);
  });

  it('shows the fields of the latest bundled component schema by default', async () => {
    const result = JSON.parse((await run('schema')).stdout);
    expect(result).toMatchObject({ kind: 'component', source: 'bundled' });
    expect(result.fields.map((f: { path: string }) => f.path)).toContain('omd_component.name');
  });

  it('validates a valid component file', async () => {
    const outcome = await run('validate', path.join(fixtures, 'component-valid.yaml'), '--skip-backstage', '--format', 'text');
    expect(outcome.stdout).toMatch(/valid against component schema v1\.4\.4 \(bundled, backstage skipped\)/);
    expect(outcome.exitCode).toBe(0);
  });

  it('requires Backstage credentials unless --skip-backstage is set', async () => {
    const saved = { url: process.env.OMD_BACKSTAGE_URL, secret: process.env.OMD_BACKSTAGE_SECRET };
    delete process.env.OMD_BACKSTAGE_URL;
    delete process.env.OMD_BACKSTAGE_SECRET;
    try {
      const outcome = await run('validate', path.join(fixtures, 'component-valid.yaml'));
      expect(outcome.exitCode).toBe(2);
      expect(JSON.parse(outcome.stdout).error).toMatch(/OMD_BACKSTAGE_URL/);
    } finally {
      if (saved.url === undefined) delete process.env.OMD_BACKSTAGE_URL;
      else process.env.OMD_BACKSTAGE_URL = saved.url;
      if (saved.secret === undefined) delete process.env.OMD_BACKSTAGE_SECRET;
      else process.env.OMD_BACKSTAGE_SECRET = saved.secret;
    }
  });

  it('reports schema errors with exit code 1', async () => {
    const outcome = await run('validate', path.join(fixtures, 'component-invalid.yaml'), '--skip-backstage');
    const result = JSON.parse(outcome.stdout);
    expect(outcome.exitCode).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('fails with exit code 2 for a version it does not ship when downloads are off', async () => {
    const outcome = await run('validate', path.join(fixtures, 'component-unknown-version.yaml'), '--skip-backstage', '--no-download');
    expect(outcome.exitCode).toBe(2);
    expect(JSON.parse(outcome.stdout).error).toMatch(/doesn't ship component schema v0\.0\.1/);
  });

  // Same shape as service-catalog-backstage: .omd/now.yaml is the service, and each
  // direct child folder is one component. Versions differ per file.
  it.each([
    ['.omd/now.yaml', 'service', 'v1.2.1'],
    ['.omd/backstage/now.yaml', 'component', 'v1.4.5'],
    ['.omd/backstage-aurora/now.yaml', 'component', 'v1.4.4'],
    ['.omd/backstage-elasticache/now.yaml', 'component', 'v1.4.0'],
    ['.omd/backstage-sqs/now.yaml', 'component', 'v1.3.0'],
  ])('validates %s against its own schema version', async (file, kind, version) => {
    const outcome = await run(
      'validate',
      path.join(repo, file),
      '--skip-backstage',
      '--repo',
      'wbd-streaming/service-catalog-backstage',
      '--format',
      'text',
    );
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toMatch(new RegExp(`valid against ${kind} schema ${version} \\(bundled, backstage skipped\\)`));
  });

  it('validates every now.yaml in a repository .omd folder', async () => {
    const outcome = await run('validate', repo, '--skip-backstage', '--repo', 'wbd-streaming/service-catalog-backstage', '--format', 'text');
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe(
      [
        '.omd/now.yaml: valid against service schema v1.2.1 (bundled, backstage skipped)',
        '.omd/backstage/now.yaml: valid against component schema v1.4.5 (bundled, backstage skipped)',
        '.omd/backstage-aurora/now.yaml: valid against component schema v1.4.4 (bundled, backstage skipped)',
        '.omd/backstage-elasticache/now.yaml: valid against component schema v1.4.0 (bundled, backstage skipped)',
        '.omd/backstage-sqs/now.yaml: valid against component schema v1.3.0 (bundled, backstage skipped)',
        '',
      ].join('\n'),
    );
  });

  it('keeps going through the other files when one component name does not match its folder', async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'omd-repo-'));
    fs.cpSync(repo, temp, { recursive: true });
    const component = path.join(temp, '.omd', 'backstage-sqs', 'now.yaml');
    fs.writeFileSync(component, fs.readFileSync(component, 'utf8').replace('name: backstage-sqs', 'name: other'));

    const outcome = await run('validate', temp, '--skip-backstage', '--repo', 'wbd-streaming/service-catalog-backstage', '--format', 'text');

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stdout).toMatch(/\.omd\/now\.yaml: valid against service schema v1\.2\.1/);
    expect(outcome.stdout).toMatch(/\.omd\/backstage-sqs\/now\.yaml: 1 error\(s\) against component schema v1\.3\.0/);
    expect(outcome.stdout).toMatch(/folder name, backstage-sqs, does not align with the specified OMD component name, other/);
  });

  it('fails with exit code 2 when the repository has no .omd folder', async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'omd-repo-'));
    const outcome = await run('validate', temp);
    expect(outcome.exitCode).toBe(2);
    expect(JSON.parse(outcome.stdout).error).toMatch(/missing \.omd folder/);
  });
});
