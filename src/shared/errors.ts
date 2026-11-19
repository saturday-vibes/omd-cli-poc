/** A mistake by the caller: bad flags, unknown version, missing file. Exit code 2. */
export class UsageError extends Error {}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
