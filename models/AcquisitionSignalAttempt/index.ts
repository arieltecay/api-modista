import { Schema, model } from 'mongoose';
import { isStatusValidForChannel } from './types.js';
import type { AcquisitionSignalAttemptPersistence, AcquisitionSignalChannel, AcquisitionSignalStatus } from './types.js';

const text = { type: String, trim: true, maxlength: 512 };

const isBrowserPixel = function (this: { channel?: string }): boolean {
  return this.channel === 'browser_pixel';
};

// Transitions between statuses are enforced by the signals service, not by the schema.
const AcquisitionSignalAttemptSchema = new Schema<AcquisitionSignalAttemptPersistence>(
  {
    eventId: { ...text, required: true },
    channel: { type: String, enum: ['browser_pixel', 'server_capi'], required: true },
    status: {
      type: String,
      required: true,
      validate: {
        validator(this: { channel?: AcquisitionSignalChannel }, value: AcquisitionSignalStatus) {
          return !this.channel || isStatusValidForChannel(this.channel, value);
        },
        message: 'status is not valid for this channel',
      },
    },
    attempts: { type: Number, default: 0, min: 0 },
    occurredAt: { type: Date, required: true },
    visitorId: { ...text, required: isBrowserPixel },
    visitId: { ...text, required: isBrowserPixel },
    latencyMs: { type: Number, min: 0 },
    errorCode: text,
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

AcquisitionSignalAttemptSchema.index({ eventId: 1, channel: 1 }, { unique: true });
// Revocation deletes by visitor; the health panel filters by time range, channel and status.
AcquisitionSignalAttemptSchema.index({ visitorId: 1 });
AcquisitionSignalAttemptSchema.index({ occurredAt: -1, channel: 1, status: 1 });

const AcquisitionSignalAttempt = model<AcquisitionSignalAttemptPersistence>(
  'AcquisitionSignalAttempt',
  AcquisitionSignalAttemptSchema,
);

export default AcquisitionSignalAttempt;
