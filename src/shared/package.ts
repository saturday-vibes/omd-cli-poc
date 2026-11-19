import * as fs from 'node:fs';
import * as path from 'node:path';

export type PackageManifest = {
  name: string;
  version: string;
  main?: string;
  dependencies?: Record<string, string>;
};

const CLI_NAME = '@test-org-th/omd-cli-poc';

let cached: { root: string; manifest: PackageManifest } | undefined;

/** The CLI's own package.json, found by walking up from this file (src/ or dist/). */
function load(): { root: string; manifest: PackageManifest } {
  if (cached) return cached;
  let dir = __dirname;
  for (;;) {
    const file = path.join(dir, 'package.json');
    if (fs.existsSync(file)) {
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as PackageManifest;
      if (manifest.name === CLI_NAME) {
        cached = { root: dir, manifest };
        return cached;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Could not find the package.json of ${CLI_NAME}`);
    dir = parent;
  }
}

export function cliPackage(): PackageManifest {
  return load().manifest;
}

export function cliRoot(): string {
  return load().root;
}
