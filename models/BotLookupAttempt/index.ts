import mongoose, { Schema } from 'mongoose';
import type { BotLookupAttemptDocument } from './types.js';

const BotLookupAttemptSchema = new Schema<BotLookupAttemptDocument>({
  platform: { type: String, enum: ['instagram', 'whatsapp'], required: true },
  platformId: { type: String, required: true },
  windowStart: { type: Date, required: true, expires: 2 * 60 * 60 },
  count: { type: Number, default: 0 },
});

BotLookupAttemptSchema.index({ platform: 1, platformId: 1, windowStart: 1 }, { unique: true });

export default mongoose.model<BotLookupAttemptDocument>('BotLookupAttempt', BotLookupAttemptSchema);
