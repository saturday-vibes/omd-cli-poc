import * as fs from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { BackstageClient } from '../../shared/backstage';
import { SchemaCatalog } from '../../shared/schemas/catalog';
import type { SchemaKind } from '../../shared/schemas/kinds';
import { compileDocument, ignoredKeywords, validationOutcome } from './rules';

const repo = path.join(__dirname, '..', '..', '..', 'test', 'repos', 'service-catalog-backstage');
const catalog = new SchemaCatalog();

function client(bodyFor: (url: string) => unknown): BackstageClient {
  const fetchImpl: typeof fetch = async input => {
    const body = bodyFor(String(input));
    return new Response(JSON.stringify(body), { status: body === undefined ? 500 : 200 });
  };
  return new BackstageClient({ url: 'https://backstage.test', secret: 'c2VjcmV0', fetch: fetchImpl });
}

async function check(file: string, kind: SchemaKind, version: string, fetchBody: (url: string) => unknown) {
  const document = yaml.load(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  const loaded = catalog.load(kind, version);
  const ctx = {
    skipBackstage: false,
    repository: 'wbd-streaming/service-catalog-backstage',
    componentNames: ['backstage', 'backstage-aurora', 'backstage-elasticache', 'backstage-sqs'],
    client: client(fetchBody),
  };
  const validate = compileDocument(loaded!.schema, ignoredKeywords(document, kind, version, file, false), ctx);
  return validationOutcome(validate, document);
}

describe('Backstage rules', () => {
  const catalogBody = (url: string): unknown => {
    if (url.includes('jira/teams')) return { CEA: ['CEA O11Y SC Service catalog'] };
    if (url.includes('kind=domain')) return [{ metadata: { name: 'observability' } }];
    return [];
  };

  it('accepts the fixture service and component when Backstage agrees', async () => {
    const service = await check(path.join(repo, '.omd', 'now.yaml'), 'service', '1.2.1', catalogBody);
    const component = await check(path.join(repo, '.omd', 'backstage', 'now.yaml'), 'component', '1.4.5', catalogBody);
    expect(service.valid).toBe(true);
    expect(component.valid).toBe(true);
  });

  it('rejects a Jira team Backstage does not list', async () => {
    const outcome = await check(path.join(repo, '.omd', 'backstage', 'now.yaml'), 'component', '1.4.5', url =>
      url.includes('jira/teams') ? { CEA: ['Some other team'] } : [],
    );
    expect(outcome.valid).toBe(false);
    expect(outcome.errors.map(error => error.message).join('\n')).toMatch(/Jira team/);
  });
});
