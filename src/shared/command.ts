import { Command, Option } from 'commander';
import type { CliOutcome, Format } from './outcome';
import { failureOutcome, formats } from './outcome';

export type Report = (outcome: CliOutcome) => void;

export type LeafSpec<F extends object = Record<string, unknown>> = {
  name: string;
  description: string;
  arguments?: string[];
  options?: () => Option[];
  run: (flags: F & { format: Format; args: string[] }) => CliOutcome | Promise<CliOutcome>;
};

export type GroupSpec = {
  name: string;
  description: string;
  commands: CommandSpec[];
  defaultCommand?: string;
};

export type CommandSpec = LeafSpec<any> | GroupSpec;

function isGroup(spec: CommandSpec): spec is GroupSpec {
  return 'commands' in spec;
}

export function buildCommand(spec: CommandSpec, report: Report): Command {
  const command = new Command(spec.name).description(spec.description).exitOverride();
  if (isGroup(spec)) {
    for (const child of spec.commands) {
      command.addCommand(buildCommand(child, report), {
        isDefault: child.name === spec.defaultCommand,
      });
    }
    return command;
  }

  for (const argument of spec.arguments ?? []) {
    command.argument(argument);
  }
  command.addOption(new Option('--format <format>', 'output format').choices(formats).default('json'));
  for (const option of spec.options?.() ?? []) {
    command.addOption(option);
  }
  command.action(async (...params: unknown[]) => {
    const flags = command.opts() as { format: Format };
    const args = params.slice(0, spec.arguments?.length ?? 0) as string[];
    try {
      report(await spec.run({ ...flags, args }));
    } catch (error) {
      report(failureOutcome(error, flags.format));
    }
  });
  return command;
}
