#!/usr/bin/env node
import { runCli } from '../program';
import { messageOf } from '../shared/errors';
import { ExitCode } from '../shared/outcome';

async function main(): Promise<void> {
  try {
    const outcome = await runCli(process.argv);
    process.stdout.write(outcome.stdout);
    process.stderr.write(outcome.stderr);
    process.exitCode = outcome.exitCode;
  } catch (error: unknown) {
    process.stderr.write(`${messageOf(error)}\n`);
    process.exitCode = ExitCode.RuntimeFailure;
  }
}

void main();
