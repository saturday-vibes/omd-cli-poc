import { Option } from 'commander';
import type { LeafSpec } from '../../../shared/command';
import { renderJson } from '../../../shared/outcome';
import { SchemaCatalog } from '../../../shared/schemas/catalog';
import type { SchemaKind } from '../../../shared/schemas/kinds';
import { kindOption, noDownloadOption } from '../options';
import { listFields } from './fields';

type Flags = { kind?: SchemaKind; version?: string; download: boolean };

export const showCommand: LeafSpec<Flags> = {
  name: 'show',
  description: 'List the fields of a schema version (latest bundled by default).',
  options: () => [
    kindOption().default('component'),
    new Option('--version <version>', 'schema version, e.g. 1.4.4 or v1.4.4'),
    noDownloadOption(),
  ],
  run: async ({ kind = 'component', version, download, format }) => {
    const loaded = await new SchemaCatalog().resolve(kind, version, { download });
    const fields = listFields(loaded.schema);
    const result = {
      kind,
      version: `v${loaded.version}`,
      package: `${loaded.packageName}@${loaded.version}`,
      source: loaded.source,
      fields,
    };
    if (format === 'json') {
      return { exitCode: 0, stdout: renderJson(result), stderr: '' };
    }
    const lines = [`${kind} schema v${loaded.version} (${loaded.source}, ${result.package})`, ''];
    for (const field of fields) {
      lines.push(`${field.path}${field.required ? ' *' : ''}  ${field.type}${field.enum ? `  [${field.enum.join(', ')}]` : ''}`);
    }
    return { exitCode: 0, stdout: `${lines.join('\n')}\n`, stderr: '' };
  },
};
