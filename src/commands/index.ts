import type { CommandSpec } from '../shared/command';
import { schemaCommand } from './schema';
import { validateCommand } from './validate';

export const commands: CommandSpec[] = [validateCommand, schemaCommand];
