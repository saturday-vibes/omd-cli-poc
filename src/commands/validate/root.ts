import * as fs from 'node:fs';
import yaml from 'js-yaml';
import type { LeafSpec } from '../../shared/command';
import { UsageError } from '../../shared/errors';
import { ExitCode, renderJson } from '../../shared/outcome';
import { compileSchema } from '../../shared/schemas/ajv';
import { SchemaCatalog } from '../../shared/schemas/catalog';
import type { SchemaKind } from '../../shared/schemas/kinds';
import { noDownloadOption } from '../schema/options';

type Flags = { download: boolean };

export const validateCommand: LeafSpec<Flags> = {
  name: 'validate',
  description: 'Validate a now.yaml against the schema version it declares (JSON Schema only, no Backstage rules).',
  arguments: ['<file>'],
  options: () => [noDownloadOption()],
  run: async ({ args: [file], download, format }) => {
    if (!fs.existsSync(file)) {
      throw new UsageError(`No such file: ${file}`);
    }
    const document = yaml.load(fs.readFileSync(file, 'utf8')) as Record<string, unknown> | null;
    if (!document || typeof document !== 'object') {
      throw new UsageError(`${file} is not a YAML mapping`);
    }
    const kind: SchemaKind = 'omd_component' in document ? 'component' : 'service';
    const declared = document.schema_version;
    if (typeof declared !== 'string') {
      throw new UsageError(`${file} has no schema_version`);
    }

    const loaded = await new SchemaCatalog().resolve(kind, declared, { download });
    const validate = compileSchema(loaded.schema);
    const valid = validate(document) as boolean;
    const errors = (validate.errors ?? []).map(error => ({
      path: error.instancePath || '/',
      message: error.message ?? error.keyword,
    }));
    const result = {
      ok: valid,
      file,
      kind,
      schemaVersion: `v${loaded.version}`,
      source: loaded.source,
      errors,
    };

    const exitCode = valid ? ExitCode.Ok : ExitCode.Invalid;
    if (format === 'json') {
      return { exitCode, stdout: renderJson(result), stderr: '' };
    }
    const header = `${file}: ${valid ? 'valid' : `${errors.length} error(s)`} against ${kind} schema v${loaded.version} (${loaded.source})`;
    const lines = [header, ...errors.map(e => `  ${e.path} ${e.message}`)];
    return { exitCode, stdout: `${lines.join('\n')}\n`, stderr: '' };
  },
};
