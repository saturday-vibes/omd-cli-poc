import Ajv from 'ajv';
import type { ErrorObject, ValidateFunction } from 'ajv';
import ajvErrors from 'ajv-errors';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BackstageClient } from '../../shared/backstage';
import type { JsonSchema } from '../../shared/schemas/catalog';
import { compareVersions } from '../../shared/schemas/kinds';

/** Keywords the action skips entirely with --skip-backstage. The others are local. */
export const BACKSTAGE_KEYWORDS = [
  'validateJiraTeam',
  'validateBusinessServiceName',
  'validateServiceNameUniqueness',
  'validateComponentNameUniqueness',
  'validateOriginField',
  'validateDependencies',
  'validateDatabaseComponentFields',
] as const;

export type RuleContext = {
  skipBackstage: boolean;
  /** `owner/name`. Uniqueness and repo-name rules fail closed when this is missing. */
  repository?: string;
  /** Component folder names in this `.omd`, accepted as dependencies without a catalog lookup. */
  componentNames: string[];
  client?: BackstageClient;
};

const NAME = /^[a-z][a-z0-9_-]{0,61}[a-z0-9]$/;
const ORIGIN = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const COMPLIANCE = ['gdpr', 'ccpa', 'sox', 'none'];

const MESSAGES: Record<string, string> = {
  validateNameRegexp:
    'This field should start with a lowercase letter, be at most 63 characters, and contain only lowercase letters, numbers, underscores, and hyphens.',
  validateJiraTeam: 'Jira team is not in the Backstage team list.',
  validateServiceNameUniqueness: 'Service name is already used by another repository in Backstage.',
  validateComponentNameUniqueness: 'Component name is already used by another repository in Backstage.',
  validateBusinessServiceName: 'Business service name is not a Backstage domain.',
  validateServiceNameAgainstRepositoryName: 'Service name must match the repository name.',
  validateDependencies: 'Dependency is not a component in this repository or in Backstage.',
  validateOmdCompliance: 'Compliance must be gdpr, ccpa, sox, none, or a "_" combination of those.',
  validateOriginField: 'Origin must be owner/name and match the service already in Backstage.',
  validateOriginRepositoryName: 'Service name does not match the repository name required when origin is set.',
  validateDatabaseComponentFields: 'Database component fields cannot change once the component is in Backstage.',
};

type KeywordCheck = (data: unknown, root: Record<string, unknown>, ctx: RuleContext) => Promise<boolean>;

const KEYWORDS: { path: string; keyword: string; check: KeywordCheck }[] = [
  { path: 'omd_service.properties.name', keyword: 'validateNameRegexp', check: nameRegexp },
  { path: 'omd_service.properties.name', keyword: 'validateServiceNameUniqueness', check: serviceUniqueness },
  { path: 'omd_service.properties.name', keyword: 'validateServiceNameAgainstRepositoryName', check: serviceMatchesRepo },
  { path: 'omd_service.properties.name', keyword: 'validateOriginRepositoryName', check: originRepoName },
  { path: 'omd_service.properties.origin', keyword: 'validateOriginField', check: originField },
  { path: 'omd_component.properties.name', keyword: 'validateNameRegexp', check: nameRegexp },
  { path: 'omd_component.properties.name', keyword: 'validateDatabaseComponentFields', check: databaseFields },
  { path: 'omd_component.properties.name', keyword: 'validateComponentNameUniqueness', check: componentUniqueness },
  { path: 'omd_component.properties.omd_team', keyword: 'validateJiraTeam', check: jiraTeam },
  { path: 'omd_component.properties.jira_team', keyword: 'validateJiraTeam', check: jiraTeam },
  { path: 'omd_business_service.properties.name', keyword: 'validateBusinessServiceName', check: businessService },
  { path: 'omd_component.properties.dependencies', keyword: 'validateDependencies', check: dependencies },
  { path: 'omd_component.properties.omd_compliance', keyword: 'validateOmdCompliance', check: compliance },
  { path: 'omd_component.properties.omd_cell', keyword: 'validateNameRegexp', check: nameRegexp },
];

export function ignoredKeywords(
  document: Record<string, unknown>,
  kind: 'component' | 'service',
  version: string,
  file: string,
  skipBackstage: boolean,
): string[] {
  const ignored = new Set(readOmdIgnore(path.join(path.dirname(file), '.omdignore')));
  if (skipBackstage) {
    for (const keyword of BACKSTAGE_KEYWORDS) ignored.add(keyword);
  }
  if (kind === 'service') {
    const service = record(document.omd_service);
    const origin = typeof service?.origin === 'string' && service.origin !== '' ? service.origin : undefined;
    if (!origin) {
      ignored.add('validateOriginField');
      ignored.add('validateOriginRepositoryName');
    } else if (compareVersions(version, '1.2.0') >= 0) {
      ignored.add('validateServiceNameAgainstRepositoryName');
      ignored.add('validateServiceNameUniqueness');
    }
  } else {
    const component = record(document.omd_component);
    const type = component?.type ?? component?.omd_type;
    if (type !== 'database') ignored.add('validateDatabaseComponentFields');
  }
  return [...ignored];
}

/** Copies the schema and stamps on the action's keywords that this file did not ignore. */
export function compileDocument(schema: JsonSchema, ignored: string[], ctx: RuleContext): ValidateFunction {
  const copy = JSON.parse(JSON.stringify(schema)) as JsonSchema;
  const attached = new Set<string>();
  for (const keyword of KEYWORDS) {
    if (ignored.includes(keyword.keyword) || !hasPath(copy, keyword.path)) continue;
    setKeyword(copy, keyword.path, keyword.keyword);
    attached.add(keyword.keyword);
  }
  if (attached.size === 0) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    ajvErrors(ajv);
    return ajv.compile(copy);
  }

  copy.$async = true;
  const ajv = new Ajv({ allErrors: true, strict: false });
  ajvErrors(ajv);
  for (const keyword of attached) {
    const check = KEYWORDS.find(item => item.keyword === keyword)?.check;
    if (!check) continue;
    ajv.addKeyword({
      keyword,
      async: true,
      schemaType: 'boolean',
      errors: true,
      validate: function validate(this: { errors?: Partial<ErrorObject>[] }, _schema: boolean, data: unknown, _parent: unknown, dataCxt?: { rootData?: unknown; instancePath?: string }) {
        const root = dataCxt?.rootData && typeof dataCxt.rootData === 'object' && !Array.isArray(dataCxt.rootData)
          ? (dataCxt.rootData as Record<string, unknown>)
          : {};
        return check(data, root, ctx).then(ok => {
          if (!ok) {
            this.errors = [{ keyword, message: MESSAGES[keyword], params: {}, instancePath: dataCxt?.instancePath ?? '' }];
          }
          return ok;
        });
      },
    });
  }
  return ajv.compile(copy);
}

export async function validationOutcome(validate: ValidateFunction, document: Record<string, unknown>): Promise<{ valid: boolean; errors: ErrorObject[] }> {
  try {
    // A sync schema returns a boolean. An async schema resolves to the data.
    const outcome = await Promise.resolve(validate(document) as boolean | Promise<unknown>);
    if (outcome === false) return { valid: false, errors: withMessages((validate.errors ?? []) as ErrorObject[]) };
    return { valid: true, errors: [] };
  } catch (error) {
    const errors = (error as { errors?: ErrorObject[] }).errors;
    if (!errors) throw error;
    return { valid: false, errors: withMessages(errors) };
  }
}

function withMessages(errors: ErrorObject[]): ErrorObject[] {
  return errors.map(error => (MESSAGES[error.keyword] ? { ...error, message: MESSAGES[error.keyword] } : error));
}

function readOmdIgnore(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'));
}

function hasPath(schema: JsonSchema, dotted: string): boolean {
  let node: unknown = schema.properties;
  for (const part of dotted.split('.')) {
    if (!node || typeof node !== 'object' || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'object' && node !== null;
}

function setKeyword(schema: JsonSchema, dotted: string, keyword: string): void {
  let node = schema.properties as Record<string, unknown>;
  for (const part of dotted.split('.')) node = node[part] as Record<string, unknown>;
  node[keyword] = true;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function repoName(repository: string | undefined): string | undefined {
  const name = repository?.split('/')[1];
  if (!name) return undefined;
  if (name.startsWith('infra-')) return name.slice('infra-'.length);
  if (name.endsWith('-dashboards')) return name.slice(0, -'-dashboards'.length);
  return name;
}

async function nameRegexp(data: unknown): Promise<boolean> {
  return typeof data === 'string' && NAME.test(data);
}

async function compliance(data: unknown): Promise<boolean> {
  return typeof data === 'string' && data.split('_').every(value => COMPLIANCE.includes(value));
}

async function jiraTeam(data: unknown, _root: Record<string, unknown>, ctx: RuleContext): Promise<boolean> {
  const teams = await ctx.client?.jiraTeams();
  if (!teams) return false;
  return Object.values(teams).some(group => group.includes(String(data)));
}

async function businessService(data: unknown, _root: Record<string, unknown>, ctx: RuleContext): Promise<boolean> {
  const domains = await ctx.client?.domains();
  if (!domains) return false;
  return domains.some(domain => domain.metadata.name === data);
}

async function serviceMatchesRepo(data: unknown, _root: Record<string, unknown>, ctx: RuleContext): Promise<boolean> {
  const expected = repoName(ctx.repository);
  return expected !== undefined && data === expected;
}

async function originRepoName(data: unknown, _root: Record<string, unknown>, ctx: RuleContext): Promise<boolean> {
  const repositoryName = ctx.repository?.split('/')[1];
  const expected = repoName(ctx.repository);
  if (!repositoryName || !expected || typeof data !== 'string') return false;
  return data === expected || repositoryName.startsWith(data);
}

async function serviceUniqueness(data: unknown, _root: Record<string, unknown>, ctx: RuleContext): Promise<boolean> {
  if (!ctx.repository || typeof data !== 'string') return false;
  const found = await ctx.client?.systems(data);
  if (!found) return false;
  if (found.length === 0) return true;
  const [org, repo] = ctx.repository.split('/');
  const expected = repoName(ctx.repository);
  const annotations = found[0].metadata.annotations;
  if (!annotations || !expected) return false;
  const [responseOrg, responseRepo] = (annotations['github.com/project-slug'] ?? '').split('/');
  const location = annotations['backstage.io/managed-by-location'] ?? '';
  const slugMatches = org === responseOrg && expected === responseRepo;
  const locationMatches = location.includes(org) && location.includes(expected);
  return slugMatches || locationMatches;
}

async function componentUniqueness(data: unknown, _root: Record<string, unknown>, ctx: RuleContext): Promise<boolean> {
  if (!ctx.repository || typeof data !== 'string') return false;
  const found = await ctx.client?.components([data]);
  if (!found) return false;
  if (found.length === 0) return true;
  const location = found[0].metadata.annotations?.['backstage.io/managed-by-location'];
  if (!location) return false;
  const sibling = ctx.repository.startsWith('wbd-streaming/infra-')
    ? ctx.repository.replace('wbd-streaming/infra-', 'wbd-streaming/')
    : ctx.repository.replace('wbd-streaming/', 'wbd-streaming/infra-');
  return location.includes(ctx.repository) || location.includes(sibling);
}

async function dependencies(data: unknown, _root: Record<string, unknown>, ctx: RuleContext): Promise<boolean> {
  if (!Array.isArray(data) || data.length === 0) return true;
  const names = data.map(item => (record(item)?.omd_component));
  if (names.some(name => typeof name !== 'string')) return false;
  const local = new Set(ctx.componentNames);
  const missing = (names as string[]).filter(name => !local.has(name));
  if (missing.length === 0) return true;
  const found = await ctx.client?.components(missing);
  if (!found) return false;
  const known = new Set(found.map(entity => entity.metadata.name));
  return missing.every(name => known.has(name));
}

async function originField(data: unknown, root: Record<string, unknown>, ctx: RuleContext): Promise<boolean> {
  if (typeof data !== 'string' || !ORIGIN.test(data)) return false;
  const serviceName = record(root.omd_service)?.name;
  const businessName = record(root.omd_business_service)?.name;
  if (typeof serviceName !== 'string') return false;
  const found = await ctx.client?.systems(serviceName);
  if (!found || found.length === 0) return false;
  const entity = found[0];
  if (entity.spec?.domain && entity.spec.domain !== businessName) return false;
  return entity.metadata.annotations?.['github.com/project-slug'] === data;
}

async function databaseFields(data: unknown, root: Record<string, unknown>, ctx: RuleContext): Promise<boolean> {
  if (typeof data !== 'string') return false;
  const component = record(root.omd_component) ?? root;
  const found = await ctx.client?.components([data]);
  if (!found) return false;
  if (found.length === 0) return true;
  const annotations = found[0].metadata.annotations ?? {};
  const fields: [string, unknown][] = [
    ['wbd.org/subdivision-strategy', component.subdivision_strategy],
    ['wbd.org/deployment-strategy', component.deployment_strategy],
    ['wbd.org/database-type', component.database_type],
    ['wbd.org/replication-strategy', component.replication_strategy],
  ];
  return fields.every(([key, value]) => annotations[key] === undefined || annotations[key] === value);
}
