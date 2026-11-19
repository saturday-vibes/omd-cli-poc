export type SchemaKind = 'component' | 'service';

export const schemaKinds: SchemaKind[] = ['component', 'service'];

export const SCHEMA_SCOPE = '@test-org-th';

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** `@test-org-th/omd-schema-component` */
export function packageName(kind: SchemaKind): string {
  return `${SCHEMA_SCOPE}/omd-schema-${kind}`;
}

/** `omd-schema-component-v1.4.4`, the dependency name the CLI installs a version under. */
export function aliasName(kind: SchemaKind, version: string): string {
  return `omd-schema-${kind}-v${bare(version)}`;
}

export const ALIAS = /^omd-schema-(component|service)-v(\d+\.\d+\.\d+)$/;

export function isVersion(value: string): boolean {
  return SEMVER.test(value);
}

/** `v1.4.4` → `1.4.4` */
export function bare(version: string): string {
  return version.replace(/^v/, '');
}

export function compareVersions(a: string, b: string): number {
  const left = bare(a).split('.').map(Number);
  const right = bare(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}
