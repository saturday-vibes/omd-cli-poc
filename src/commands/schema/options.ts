import { Option } from 'commander';
import { schemaKinds } from '../../shared/schemas/kinds';

export function kindOption(): Option {
  return new Option('--kind <kind>', 'schema kind').choices(schemaKinds);
}

export function noDownloadOption(): Option {
  return new Option('--no-download', "fail instead of downloading a schema version this CLI doesn't ship");
}
