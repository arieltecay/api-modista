import mongoose, { Schema, Document } from 'mongoose';

export interface IFunnelEvent extends Document {
  uuid: string;
  stepName: string;
  courseTitle: string;
  metaFbc?: string;
  metaFbp?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  timestamp: Date;
}

const FunnelEventSchema: Schema = new Schema({
  uuid: { type: String, required: true },
  stepName: { type: String, required: true },
  courseTitle: { type: String, required: true },
  metaFbc: { type: String, required: false },
  metaFbp: { type: String, required: false },
  clientIpAddress: { type: String, required: false },
  clientUserAgent: { type: String, required: false },
  timestamp: { type: Date, default: Date.now },
});

export default mongoose.model<IFunnelEvent>('FunnelEvent', FunnelEventSchema);
