import { Command, CommanderError } from 'commander';
import { commands as topLevelCommands } from './commands';
import type { CommandSpec } from './shared/command';
import { buildCommand } from './shared/command';
import { messageOf } from './shared/errors';
import type { CliOutcome } from './shared/outcome';
import { ExitCode, errorOutcome } from './shared/outcome';
import { cliPackage } from './shared/package';

export async function runCli(argv: string[], commands: CommandSpec[] = topLevelCommands): Promise<CliOutcome> {
  let stdout = '';
  let stderr = '';
  let outcome: CliOutcome | undefined;

  const program = new Command('omd')
    .description('POC: validate OMD now.yaml files against per-version schema packages.')
    .version(cliPackage().version)
    .exitOverride()
    .configureOutput({
      writeOut: value => (stdout += value),
      writeErr: value => (stderr += value),
    });
  for (const spec of commands) {
    program.addCommand(
      buildCommand(spec, result => {
        outcome = result;
      }),
    );
  }

  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      return { exitCode: error.exitCode === 0 ? ExitCode.Ok : ExitCode.Usage, stdout, stderr };
    }
    return errorOutcome(messageOf(error), 'text', ExitCode.RuntimeFailure);
  }
  return outcome ?? { exitCode: ExitCode.Ok, stdout, stderr };
}
