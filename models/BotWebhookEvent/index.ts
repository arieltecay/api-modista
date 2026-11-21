import mongoose, { Schema } from 'mongoose';

const BotWebhookEventSchema = new Schema({
  platform: { type: String, enum: ['instagram', 'whatsapp'], required: true },
  messageId: { type: String, required: true },
  status: { type: String, enum: ['processing', 'complete', 'failed'], required: true },
  claimedAt: { type: Date, required: true },
  attempts: { type: Number, default: 1 },
  expiresAt: { type: Date, required: true, default: () => new Date(Date.now() + 7 * 24 * 60 * 60_000) },
});

BotWebhookEventSchema.index({ platform: 1, messageId: 1 }, { unique: true });
BotWebhookEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('BotWebhookEvent', BotWebhookEventSchema);
