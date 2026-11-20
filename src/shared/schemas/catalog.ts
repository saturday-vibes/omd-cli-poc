import * as fs from 'node:fs';
import * as path from 'node:path';
import { UsageError } from '../errors';
import type { PackageManifest } from '../package';
import { cliPackage, cliRoot } from '../package';
import type { SchemaKind } from './kinds';
import { ALIAS, aliasName, bare, compareVersions, isVersion, packageName } from './kinds';

/** The subset of JSON Schema that the CLI reads. */
export type JsonSchema = {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  [keyword: string]: unknown;
};

export type LoadedSchema = {
  kind: SchemaKind;
  /** `1.4.4` */
  version: string;
  packageName: string;
  schema: JsonSchema;
};

export type CatalogOptions = {
  manifest?: PackageManifest;
  /** Where aliases resolve from. Defaults to the CLI's install folder. */
  root?: string;
};

/**
 * Lists and loads the schema versions this CLI ships: the `omd-schema-<kind>-v<x.y.z>`
 * aliases in its own package.json.
 */
export class SchemaCatalog {
  private readonly manifest: PackageManifest;
  private readonly root: string;

  constructor(options: CatalogOptions = {}) {
    this.manifest = options.manifest ?? cliPackage();
    this.root = options.root ?? cliRoot();
  }

  /** Shipped versions of a kind, newest first, as `1.4.4`. */
  versions(kind: SchemaKind): string[] {
    return Object.keys(this.manifest.dependencies ?? {})
      .map(name => ALIAS.exec(name))
      .filter((match): match is RegExpExecArray => match?.[1] === kind)
      .map(match => match[2])
      .sort((a, b) => compareVersions(b, a));
  }

  latest(kind: SchemaKind): string | undefined {
    return this.versions(kind)[0];
  }

  /** A shipped version (latest when omitted). Anything else is a usage error. */
  load(kind: SchemaKind, version?: string): LoadedSchema {
    const requested = version ?? this.latest(kind);
    if (!requested) {
      throw new UsageError(`This CLI ships no ${kind} schemas`);
    }
    if (!isVersion(requested)) {
      throw new UsageError(`Invalid schema version: ${requested}. Expected X.Y.Z or vX.Y.Z`);
    }
    if (!this.versions(kind).includes(bare(requested))) {
      throw new UsageError(
        `This CLI doesn't ship ${kind} schema ${requested}. Shipped: ${this.versions(kind).join(', ') || 'none'}. Update the CLI.`,
      );
    }
    const manifestPath = require.resolve(`${aliasName(kind, requested)}/package.json`, { paths: [this.root] });
    return readPackage(kind, bare(requested), path.dirname(manifestPath));
  }
}

function readPackage(kind: SchemaKind, version: string, dir: string): LoadedSchema {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as PackageManifest;
  if (manifest.name !== packageName(kind) || manifest.version !== version) {
    throw new Error(`${dir} holds ${manifest.name}@${manifest.version}, expected ${packageName(kind)}@${version}`);
  }
  const schema = JSON.parse(fs.readFileSync(path.join(dir, manifest.main ?? 'schema.json'), 'utf8')) as JsonSchema;
  return { kind, version, packageName: manifest.name, schema };
}
