import type { GroupSpec } from '../../shared/command';
import { showCommand } from './show';
import { versionsCommand } from './versions';

export const schemaCommand: GroupSpec = {
  name: 'schema',
  description: 'Inspect the OMD schemas.',
  commands: [showCommand, versionsCommand],
  defaultCommand: 'show',
};
