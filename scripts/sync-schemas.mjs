// Adds an alias for every published schema version the CLI doesn't ship yet.
//
//   node scripts/sync-schemas.mjs [--dry-run]
//
// Prints a JSON summary: { added: [{ kind, version, alias }], title }. The workflow
// uses `title` for the PR. Exact versions only, never ranges.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const SCOPE = '@test-org-th';
const KINDS = ['component', 'service'];
const ALIAS = /^omd-schema-(component|service)-v(\d+\.\d+\.\d+)$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const shipped = new Set(
  Object.keys(pkg.dependencies ?? {})
    .map(name => ALIAS.exec(name))
    .filter(Boolean)
    .map(([, kind, version]) => `${kind}@${version}`),
);

function published(kind) {
  const out = execFileSync('npm', ['view', `${SCOPE}/omd-schema-${kind}`, 'versions', '--json'], {
    encoding: 'utf8',
  });
  return [JSON.parse(out)].flat().filter(v => SEMVER.test(v));
}

const added = [];
for (const kind of KINDS) {
  for (const version of published(kind)) {
    if (shipped.has(`${kind}@${version}`)) continue;
    added.push({ kind, version, alias: `omd-schema-${kind}-v${version}` });
  }
}

if (added.length && !process.argv.includes('--dry-run')) {
  const specs = added.map(a => `${a.alias}@npm:${SCOPE}/omd-schema-${a.kind}@${a.version}`);
  execFileSync('yarn', ['add', ...specs], { stdio: 'inherit' });
}

const describe = added.map(a => `${a.kind} ${a.version}`);
const title = added.length
  ? `feat(schema): add ${describe.length > 3 ? `${describe.length} schema versions` : describe.join(', ')}`
  : '';
process.stdout.write(`${JSON.stringify({ added, title })}\n`);
