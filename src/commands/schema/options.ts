import { Option } from 'commander';
import { schemaKinds } from '../../shared/schemas/kinds';

export function kindOption(): Option {
  return new Option('--kind <kind>', 'schema kind').choices(schemaKinds);
}
