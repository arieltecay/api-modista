import { Schema, model, Document } from 'mongoose';

export interface IMetaEventDlq extends Document {
  eventName: string;
  eventId: string;
  outboxVersion?: number;
  payload?: Record<string, unknown>;
  attempts: number;
  lastError?: string;
  status: 'pending' | 'sent' | 'failed' | 'exhausted';
  deliveryMode?: 'direct' | 'retry';
  directSendClaim?: string;
  nextRetryAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MetaEventDlqSchema = new Schema<IMetaEventDlq>(
  {
    eventName: { type: String, required: true, index: true },
    eventId: { type: String, required: true, index: true },
    outboxVersion: { type: Number, required: false },
    payload: { type: Schema.Types.Mixed, required: true },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    status: {
      type: String,
      enum: ['pending', 'sent', 'failed', 'exhausted'],
      default: 'pending',
      index: true,
    },
    deliveryMode: { type: String, enum: ['direct', 'retry'], required: false },
    directSendClaim: { type: String, required: false },
    nextRetryAt: { type: Date, default: () => new Date(), index: true },
  },
  { timestamps: true }
);

MetaEventDlqSchema.index({ status: 1, nextRetryAt: 1 });
MetaEventDlqSchema.index(
  { eventId: 1, outboxVersion: 1 },
  { unique: true, partialFilterExpression: { outboxVersion: 2 } },
);

const MetaEventDlq = model<IMetaEventDlq>('MetaEventDlq', MetaEventDlqSchema);
export default MetaEventDlq;
