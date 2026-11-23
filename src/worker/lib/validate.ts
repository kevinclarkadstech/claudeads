const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Guard route params before they reach a Postgres uuid column (which would throw). */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
