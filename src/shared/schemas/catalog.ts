import * as fs from 'node:fs';
import * as path from 'node:path';
import { UsageError } from '../errors';
import type { PackageManifest } from '../package';
import { cliPackage, cliRoot } from '../package';
import { downloadSchemaPackage } from './download';
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
  /** bundled: installed with the CLI through an alias; downloaded: fetched at runtime into the cache */
  source: 'bundled' | 'downloaded';
  schema: JsonSchema;
  /** The sample now.yaml shipped in the package, if any. */
  sample?: string;
};

export type Downloader = (kind: SchemaKind, version: string) => Promise<string>;

export type CatalogOptions = {
  manifest?: PackageManifest;
  /** Where aliases resolve from. Defaults to the CLI's install folder. */
  root?: string;
  download?: Downloader;
};

/**
 * Lists and loads schema versions. Bundled versions are the `omd-schema-<kind>-v<x.y.z>`
 * aliases in the CLI's own package.json; anything else can be downloaded at runtime.
 */
export class SchemaCatalog {
  private readonly manifest: PackageManifest;
  private readonly root: string;
  private readonly download: Downloader;

  constructor(options: CatalogOptions = {}) {
    this.manifest = options.manifest ?? cliPackage();
    this.root = options.root ?? cliRoot();
    this.download = options.download ?? downloadSchemaPackage;
  }

  /** Bundled versions of a kind, newest first, as `1.4.4`. */
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

  /** A bundled version, or `undefined` if this CLI doesn't ship it. */
  load(kind: SchemaKind, version: string): LoadedSchema | undefined {
    if (!isVersion(version) || !this.versions(kind).includes(bare(version))) {
      return undefined;
    }
    const alias = aliasName(kind, version);
    const manifestPath = require.resolve(`${alias}/package.json`, { paths: [this.root] });
    return readPackage(kind, bare(version), path.dirname(manifestPath), 'bundled');
  }

  /**
   * A bundled version, else a downloaded one. `download: false` turns the download off,
   * which makes an unknown version a usage error.
   */
  async resolve(kind: SchemaKind, version: string | undefined, options: { download?: boolean } = {}): Promise<LoadedSchema> {
    const requested = version ?? this.latest(kind);
    if (!requested) {
      throw new UsageError(`This CLI ships no ${kind} schemas`);
    }
    if (!isVersion(requested)) {
      throw new UsageError(`Invalid schema version: ${requested}. Expected X.Y.Z or vX.Y.Z`);
    }
    const bundled = this.load(kind, requested);
    if (bundled) return bundled;
    if (options.download === false) {
      throw new UsageError(
        `This CLI doesn't ship ${kind} schema ${requested}. Bundled: ${this.versions(kind).join(', ') || 'none'}. ` +
          'Run without --no-download to fetch it, or update the CLI.',
      );
    }
    const dir = await this.download(kind, bare(requested));
    return readPackage(kind, bare(requested), dir, 'downloaded');
  }
}

function readPackage(kind: SchemaKind, version: string, dir: string, source: LoadedSchema['source']): LoadedSchema {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as PackageManifest;
  if (manifest.name !== packageName(kind) || manifest.version !== version) {
    throw new Error(`${dir} holds ${manifest.name}@${manifest.version}, expected ${packageName(kind)}@${version}`);
  }
  const schema = JSON.parse(fs.readFileSync(path.join(dir, manifest.main ?? 'schema.json'), 'utf8')) as JsonSchema;
  const samplePath = path.join(dir, 'sample', 'now.yaml');
  const sample = fs.existsSync(samplePath) ? fs.readFileSync(samplePath, 'utf8') : undefined;
  return { kind, version, packageName: manifest.name, source, schema, sample };
}
