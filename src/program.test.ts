import * as path from 'node:path';
import { runCli } from './program';
import { cliPackage } from './shared/package';

const fixtures = path.join(__dirname, '..', 'test', 'fixtures');
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

  it('shows the fields of the latest component schema by default', async () => {
    const result = JSON.parse((await run('schema')).stdout);
    expect(result).toMatchObject({ kind: 'component' });
    expect(result.fields.map((f: { path: string }) => f.path)).toContain('omd_component.name');
  });

  it('validates a valid component file', async () => {
    const outcome = await run('validate', path.join(fixtures, 'component-valid.yaml'), '--format', 'text');
    expect(outcome.stdout).toMatch(/valid against component schema v1\.4\.4$/m);
    expect(outcome.exitCode).toBe(0);
  });

  it('reports schema errors with exit code 1', async () => {
    const outcome = await run('validate', path.join(fixtures, 'component-invalid.yaml'));
    const result = JSON.parse(outcome.stdout);
    expect(outcome.exitCode).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('fails with exit code 2 for a version it does not ship', async () => {
    const outcome = await run('validate', path.join(fixtures, 'component-unknown-version.yaml'));
    expect(outcome.exitCode).toBe(2);
    expect(JSON.parse(outcome.stdout).error).toMatch(/doesn't ship component schema v0\.0\.1/);
  });
});
