import { Schema, model, Document } from 'mongoose';

export interface IMetaEventDlq extends Document {
  eventName: string;
  eventId: string;
  payload: Record<string, unknown>;
  attempts: number;
  lastError?: string;
  status: 'pending' | 'sent' | 'failed' | 'exhausted';
  nextRetryAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MetaEventDlqSchema = new Schema<IMetaEventDlq>(
  {
    eventName: { type: String, required: true, index: true },
    eventId: { type: String, required: true, index: true },
    payload: { type: Schema.Types.Mixed, required: true },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    status: {
      type: String,
      enum: ['pending', 'sent', 'failed', 'exhausted'],
      default: 'pending',
      index: true,
    },
    nextRetryAt: { type: Date, default: () => new Date(), index: true },
  },
  { timestamps: true }
);

MetaEventDlqSchema.index({ status: 1, nextRetryAt: 1 });

const MetaEventDlq = model<IMetaEventDlq>('MetaEventDlq', MetaEventDlqSchema);
export default MetaEventDlq;
