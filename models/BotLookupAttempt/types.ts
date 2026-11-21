export interface BotLookupAttemptDocument {
  platform: 'instagram' | 'whatsapp';
  platformId: string;
  createdAt: Date;
}
