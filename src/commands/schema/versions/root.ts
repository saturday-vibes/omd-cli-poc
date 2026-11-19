import type { LeafSpec } from '../../../shared/command';
import { renderJson } from '../../../shared/outcome';
import { SchemaCatalog } from '../../../shared/schemas/catalog';
import type { SchemaKind } from '../../../shared/schemas/kinds';
import { packageName, schemaKinds } from '../../../shared/schemas/kinds';
import { kindOption } from '../options';

type Flags = { kind?: SchemaKind };

export const versionsCommand: LeafSpec<Flags> = {
  name: 'versions',
  description: 'List the schema versions bundled with this CLI, newest first.',
  options: () => [kindOption()],
  run: ({ kind, format }) => {
    const catalog = new SchemaCatalog();
    const kinds = kind ? [kind] : schemaKinds;
    const result = Object.fromEntries(
      kinds.map(k => [k, { package: packageName(k), versions: catalog.versions(k).map(v => `v${v}`) }]),
    );
    if (format === 'json') {
      return { exitCode: 0, stdout: renderJson(result), stderr: '' };
    }
    const lines = kinds.map(k => `${k}: ${result[k].versions.join(', ') || 'none'}`);
    return { exitCode: 0, stdout: `${lines.join('\n')}\n`, stderr: '' };
  },
};
