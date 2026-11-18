import { Schema, model } from 'mongoose';
import { ACQUISITION_EVENT_NAMES } from './types.js';
import type { AcquisitionEventPersistence } from './types.js';

const text = { type: String, trim: true, maxlength: 512 };
const requiredText = { ...text, required: true };
// Site-relative path without query or hash, so `?email=` or click ids never reach the database.
const cleanPath = { ...text, match: /^\/[^?#]*$/ };

// No open-ended `properties` bag on purpose: every field is explicit to avoid accidental PII.
const AcquisitionEventSchema = new Schema<AcquisitionEventPersistence>({
  eventId: { ...requiredText, unique: true },
  visitId: requiredText,
  visitorId: requiredText,
  name: { type: String, enum: ACQUISITION_EVENT_NAMES, required: true },
  occurredAt: { type: Date, required: true },
  receivedAt: { type: Date, default: Date.now },
  source: { type: String, enum: ['browser', 'server', 'backfill'], required: true },
  schemaVersion: { type: Number, default: 1 },
  path: cleanPath,
  landingSlug: text,
  courseId: text,
  inscriptionId: text,
  value: { type: Number, min: 0 },
  currency: { type: String, enum: ['ARS'] },
});

AcquisitionEventSchema.index({ visitId: 1, occurredAt: 1 });
AcquisitionEventSchema.index({ name: 1, occurredAt: -1 });
AcquisitionEventSchema.index({ inscriptionId: 1, name: 1 });
AcquisitionEventSchema.index({ courseId: 1, occurredAt: -1 });
// Consent revocation deletes by visitor; the live panel and freshness check read the newest receipts.
AcquisitionEventSchema.index({ visitorId: 1 });
AcquisitionEventSchema.index({ receivedAt: -1 });
// Range scans of the quality report.
AcquisitionEventSchema.index({ occurredAt: -1 });

const AcquisitionEvent = model<AcquisitionEventPersistence>('AcquisitionEvent', AcquisitionEventSchema);

export default AcquisitionEvent;
