import mongoose, { Schema } from 'mongoose';
import type { BotEnrollmentConfigDocument } from './types.js';

const templateField = { type: String, maxlength: 500 };

const BotEnrollmentConfigSchema = new Schema<BotEnrollmentConfigDocument>({
  key: { type: String, enum: ['default'], default: 'default', unique: true },
  whatsappLookupEnabled: { type: Boolean, default: false },
  templates: {
    header: templateField,
    paid: templateField,
    partial: templateField,
    pending: templateField,
    review: templateField,
    footer: templateField,
    notFound: templateField,
    askContact: templateField,
    rateLimited: templateField,
  },
}, { timestamps: true });

export default mongoose.model<BotEnrollmentConfigDocument>('BotEnrollmentConfig', BotEnrollmentConfigSchema);
