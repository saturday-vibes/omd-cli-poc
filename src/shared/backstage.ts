import { createHmac } from 'node:crypto';
import { UsageError } from './errors';

export type JiraTeams = Record<string, string[]>;

export type CatalogEntity = {
  metadata: { name: string; annotations?: Record<string, string> };
  spec?: { domain?: string };
};

export type BackstageClientOptions = {
  url: string;
  /** A bearer token, or the base64 HMAC secret the action signs into a token. */
  secret: string;
  fetch?: typeof fetch;
};

const TOKEN_LIFETIME_SECONDS = 60;

/**
 * One client per validate run. A failed lookup comes back as `undefined`;
 * the rule then fails the field, which is what the action does.
 */
export class BackstageClient {
  private readonly cache = new Map<string, Promise<unknown>>();
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;

  constructor(private readonly options: BackstageClientOptions) {
    this.baseUrl = options.url.endsWith('/') ? options.url : `${options.url}/`;
    this.fetch = options.fetch ?? fetch;
  }

  domains(): Promise<CatalogEntity[] | undefined> {
    return this.entities(['kind=domain']);
  }

  systems(name: string): Promise<CatalogEntity[] | undefined> {
    return this.entities([`kind=system,metadata.name=${encodeURIComponent(name)}`]);
  }

  components(names: string[]): Promise<CatalogEntity[] | undefined> {
    if (names.length === 0) return Promise.resolve([]);
    return this.entities(names.map(name => `kind=component,metadata.name=${encodeURIComponent(name)}`));
  }

  jiraTeams(): Promise<JiraTeams | undefined> {
    return this.cached('api/omd-validation/jira/teams', isJiraTeams);
  }

  private entities(filters: string[]): Promise<CatalogEntity[] | undefined> {
    const query = filters.map(filter => `filter=${filter}`).join('&');
    return this.cached(`api/catalog/entities?${query}`, isEntityList);
  }

  private cached<T>(apiPath: string, isExpected: (body: unknown) => body is T): Promise<T | undefined> {
    let result = this.cache.get(apiPath) as Promise<T | undefined> | undefined;
    if (!result) {
      result = this.get(apiPath, isExpected).then(body => {
        if (body === undefined) this.cache.delete(apiPath);
        return body;
      });
      this.cache.set(apiPath, result);
    }
    return result;
  }

  private async get<T>(apiPath: string, isExpected: (body: unknown) => body is T): Promise<T | undefined> {
    try {
      const response = await this.fetch(`${this.baseUrl}${apiPath}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearer(this.options.secret)}`,
        },
      });
      if (!response.ok) return undefined;
      const body: unknown = await response.json();
      return isExpected(body) ? body : undefined;
    } catch {
      return undefined;
    }
  }
}

function bearer(secret: string): string {
  if (secret.split('.').length === 3) return secret;
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(secret)) {
    throw new UsageError('OMD_BACKSTAGE_SECRET is not a JWT or base64 HMAC secret');
  }
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS;
  const unsigned = `${base64url({ alg: 'HS256' })}.${base64url({ sub: 'backstage-server', exp: expiresAt })}`;
  const encoding = secret.includes('+') || secret.includes('/') ? 'base64' : 'base64url';
  const signature = createHmac('sha256', Buffer.from(secret, encoding)).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function isEntityList(value: unknown): value is CatalogEntity[] {
  return Array.isArray(value);
}

function isJiraTeams(value: unknown): value is JiraTeams {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every(teams => Array.isArray(teams) && teams.every(team => typeof team === 'string'));
}
