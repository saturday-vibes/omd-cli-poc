import { UsageError, messageOf } from './errors';

export type CliOutcome = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export const formats = ['json', 'text'] as const;

export type Format = (typeof formats)[number];

export const ExitCode = {
  Ok: 0,
  Invalid: 1,
  Usage: 2,
  RuntimeFailure: 3,
} as const;

export function renderJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function errorOutcome(message: string, format: Format, exitCode: number): CliOutcome {
  const text = message.trim();
  if (format === 'json') {
    return { exitCode, stdout: renderJson({ ok: false, error: text }), stderr: '' };
  }
  return { exitCode, stdout: '', stderr: `${text}\n` };
}

export function failureOutcome(error: unknown, format: Format): CliOutcome {
  return errorOutcome(
    messageOf(error),
    format,
    error instanceof UsageError ? ExitCode.Usage : ExitCode.RuntimeFailure,
  );
}
