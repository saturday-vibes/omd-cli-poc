import { Option } from 'commander';
import { schemaKinds } from '../../shared/schemas/kinds';

export function kindOption(): Option {
  return new Option('--kind <kind>', 'schema kind').choices(schemaKinds);
}

export function noDownloadOption(): Option {
  return new Option('--no-download', "fail instead of downloading a schema version this CLI doesn't ship");
}

export function skipBackstageOption(): Option {
  return new Option('--skip-backstage', 'JSON Schema only. Skips the Backstage lookups the action runs.');
}

export function repoOption(): Option {
  return new Option('--repo <owner/name>', 'repository slug for name and uniqueness checks. Defaults to GITHUB_REPOSITORY, then the git remote.');
}

export function backstageUrlOption(): Option {
  return new Option('--backstage-url <url>', 'Backstage base URL. Defaults to OMD_BACKSTAGE_URL.');
}
