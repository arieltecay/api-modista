import mongoose, { Schema } from 'mongoose';
import type { BotLookupAttemptDocument } from './types.js';

const BotLookupAttemptSchema = new Schema<BotLookupAttemptDocument>({
  platform: { type: String, enum: ['instagram', 'whatsapp'], required: true },
  platformId: { type: String, required: true },
  createdAt: { type: Date, default: () => new Date(), expires: 60 * 60 },
});

BotLookupAttemptSchema.index({ platform: 1, platformId: 1, createdAt: -1 });

export default mongoose.model<BotLookupAttemptDocument>('BotLookupAttempt', BotLookupAttemptSchema);
