import { Schema, model } from 'mongoose';
import type { AcquisitionVisitPersistence } from './types.js';

const text = { type: String, trim: true, maxlength: 512 };
const requiredText = { ...text, required: true };
// Site-relative path without query or hash, so `?email=` or click ids never reach the database.
const requiredCleanPath = { ...requiredText, match: /^\/[^?#]*$/ };

const AcquisitionVisitSchema = new Schema<AcquisitionVisitPersistence>(
  {
    visitId: { ...requiredText, unique: true },
    visitorId: requiredText,
    startedAt: { type: Date, required: true },
    lastActivityAt: { type: Date, required: true },
    entryPath: requiredCleanPath,
    landingSlug: text,
    referrerHost: text,
    rawAttribution: {
      source: text,
      medium: text,
      campaign: text,
      term: text,
      content: text,
    },
    classification: {
      sourcePlatform: requiredText,
      acquisitionType: requiredText,
      channelGroup: requiredText,
      reason: requiredText,
      classifierVersion: { type: Number, required: true },
    },
    device: { type: String, enum: ['mobile', 'desktop', 'tablet', 'unknown'], default: 'unknown' },
    hasFbc: { type: Boolean, default: false },
    hasFbp: { type: Boolean, default: false },
    consentVersion: requiredText,
    schemaVersion: { type: Number, default: 1 },
  },
  { timestamps: true },
);

AcquisitionVisitSchema.index({ visitorId: 1, startedAt: -1 });
AcquisitionVisitSchema.index({ startedAt: -1, 'classification.channelGroup': 1 });
AcquisitionVisitSchema.index({ 'rawAttribution.campaign': 1, startedAt: -1 });
AcquisitionVisitSchema.index({ landingSlug: 1, startedAt: -1 });
// The live panel counts visits touched recently (server time).
AcquisitionVisitSchema.index({ updatedAt: -1 });

const AcquisitionVisit = model<AcquisitionVisitPersistence>('AcquisitionVisit', AcquisitionVisitSchema);

export default AcquisitionVisit;
