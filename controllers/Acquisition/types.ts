/** Result of an idempotent write: first time, repeat, or an id owned by another visitor. */
export type IngestionOutcome = 'created' | 'updated' | 'conflict';
