import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { UsageError } from '../errors';
import { SchemaCatalog } from './catalog';

function fakePackage(dir: string, name: string, version: string): string {
  fs.mkdirSync(path.join(dir, 'sample'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version, main: 'schema.json' }));
  fs.writeFileSync(path.join(dir, 'schema.json'), JSON.stringify({ type: 'object', properties: { a: { type: 'string' } } }));
  fs.writeFileSync(path.join(dir, 'sample', 'now.yaml'), `schema_version: v${version}\n`);
  return dir;
}

describe('SchemaCatalog', () => {
  const manifest = {
    name: '@test-org-th/omd-cli-poc',
    version: '0.0.0',
    dependencies: {
      commander: '^14.0.0',
      'omd-schema-component-v1.2.0': 'npm:@test-org-th/omd-schema-component@1.2.0',
      'omd-schema-component-v1.10.0': 'npm:@test-org-th/omd-schema-component@1.10.0',
      'omd-schema-service-v1.0.0': 'npm:@test-org-th/omd-schema-service@1.0.0',
    },
  };

  it('lists bundled versions per kind from the aliases, newest first', () => {
    const catalog = new SchemaCatalog({ manifest });
    expect(catalog.versions('component')).toEqual(['1.10.0', '1.2.0']);
    expect(catalog.versions('service')).toEqual(['1.0.0']);
    expect(catalog.latest('component')).toBe('1.10.0');
  });

  it('downloads a version it does not ship', async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-'));
    const download = jest.fn(async () => fakePackage(temp, '@test-org-th/omd-schema-component', '1.5.0'));
    const catalog = new SchemaCatalog({ manifest, download });

    const loaded = await catalog.resolve('component', 'v1.5.0');

    expect(download).toHaveBeenCalledWith('component', '1.5.0');
    expect(loaded).toMatchObject({ version: '1.5.0', source: 'downloaded', sample: 'schema_version: v1.5.0\n' });
  });

  it('refuses to download with download: false', async () => {
    const download = jest.fn();
    const catalog = new SchemaCatalog({ manifest, download });
    await expect(catalog.resolve('component', '1.5.0', { download: false })).rejects.toThrow(UsageError);
    expect(download).not.toHaveBeenCalled();
  });

  it('rejects a package that is not the requested version', async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-'));
    const download = async () => fakePackage(temp, '@test-org-th/omd-schema-component', '1.4.0');
    const catalog = new SchemaCatalog({ manifest, download });
    await expect(catalog.resolve('component', '1.5.0')).rejects.toThrow('expected @test-org-th/omd-schema-component@1.5.0');
  });

  it('rejects versions that are not X.Y.Z', async () => {
    const catalog = new SchemaCatalog({ manifest, download: jest.fn() });
    await expect(catalog.resolve('component', 'latest')).rejects.toThrow('Invalid schema version');
  });
});
