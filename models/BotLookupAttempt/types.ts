export interface BotLookupAttemptDocument {
  platform: 'instagram' | 'whatsapp';
  platformId: string;
  /** Inicio de la hora a la que pertenece el contador. */
  windowStart: Date;
  count: number;
}
