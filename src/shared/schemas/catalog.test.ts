import { UsageError } from '../errors';
import { SchemaCatalog } from './catalog';

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

  it('lists shipped versions per kind from the aliases, newest first', () => {
    const catalog = new SchemaCatalog({ manifest });
    expect(catalog.versions('component')).toEqual(['1.10.0', '1.2.0']);
    expect(catalog.versions('service')).toEqual(['1.0.0']);
    expect(catalog.latest('component')).toBe('1.10.0');
  });

  it('rejects a version it does not ship', () => {
    const catalog = new SchemaCatalog({ manifest });
    expect(() => catalog.load('component', '1.5.0')).toThrow(UsageError);
    expect(() => catalog.load('component', '1.5.0')).toThrow("doesn't ship component schema 1.5.0");
  });

  it('rejects versions that are not X.Y.Z', () => {
    const catalog = new SchemaCatalog({ manifest });
    expect(() => catalog.load('component', 'latest')).toThrow('Invalid schema version');
  });
});
