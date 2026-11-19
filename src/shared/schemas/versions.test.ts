// Runs for every schema version the CLI ships, so adding an alias is all it takes to
// cover a new version. A new version without a snapshot fails in CI (`jest --ci`);
// the schema-sync workflow writes it and the PR shows it as the field diff.
import yaml from 'js-yaml';
import { listFields } from '../../commands/schema/show/fields';
import { compileSchema } from './ajv';
import { SchemaCatalog } from './catalog';
import { packageName, schemaKinds } from './kinds';

const catalog = new SchemaCatalog();

describe.each(schemaKinds)('%s schemas', kind => {
  const versions = catalog.versions(kind);

  it('ships at least one version', () => {
    expect(versions.length).toBeGreaterThan(0);
  });

  describe.each(versions)('v%s', version => {
    const loaded = catalog.load(kind, version);

    it('resolves its alias to the matching package and version', () => {
      expect(loaded).toMatchObject({ packageName: packageName(kind), version, source: 'bundled' });
    });

    it('compiles', () => {
      expect(() => compileSchema(loaded!.schema)).not.toThrow();
    });

    it('has fields the CLI can list', () => {
      expect(listFields(loaded!.schema).length).toBeGreaterThan(0);
    });

    it('ships a sample declaring this version', () => {
      const sample = yaml.load(loaded!.sample ?? '') as { schema_version?: string } | undefined;
      expect(sample?.schema_version).toBe(`v${version}`);
    });

    it('matches the field snapshot', () => {
      const fields = listFields(loaded!.schema).map(
        f => `${f.path}${f.required ? ' *' : ''}: ${f.type}${f.enum ? ` [${f.enum.join(', ')}]` : ''}`,
      );
      expect(fields).toMatchSnapshot();
    });
  });
});
