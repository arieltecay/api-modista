/**
 * Error safe to log for the public telemetry endpoints: driver messages quote the offending values
 * (paths, ids, referrers), so only the name, code and stack frames are kept.
 */
export const redactError = (error: unknown): Error => {
  const name = error instanceof Error ? error.name : 'UnknownError';
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  const redacted = new Error(code === undefined ? name : `${name} (${String(code)})`);
  const frames = error instanceof Error ? (error.stack ?? '').split('\n').filter((line) => line.trim().startsWith('at ')) : [];
  redacted.stack = [`Error: ${redacted.message}`, ...frames].join('\n');
  return redacted;
};
