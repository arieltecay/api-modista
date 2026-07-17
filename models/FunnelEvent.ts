import mongoose, { Schema, Document } from 'mongoose';

export interface IFunnelEvent extends Document {
  sessionId: string;
  step: string;
  courseId?: string;
  courseTitle?: string;
  inscriptionId?: string;
  value?: number;
  utmSource?: string;
  utmCampaign?: string;
  utmMedium?: string;
  referrer?: string;
  device?: 'mobile' | 'desktop';
  metaFbc?: string;
  metaFbp?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  timestamp: Date;
}

const FunnelEventSchema: Schema = new Schema(
  {
    sessionId: { type: String, required: true, index: true },
    step: { type: String, required: true, index: true },
    courseId: { type: String, required: false, index: true },
    courseTitle: { type: String, required: false },
    inscriptionId: { type: String, required: false, index: true },
    value: { type: Number, required: false },
    utmSource: { type: String, required: false, index: true },
    utmCampaign: { type: String, required: false, index: true },
    utmMedium: { type: String, required: false },
    referrer: { type: String, required: false },
    device: { type: String, enum: ['mobile', 'desktop'], required: false },
    metaFbc: { type: String, required: false },
    metaFbp: { type: String, required: false },
    clientIpAddress: { type: String, required: false },
    clientUserAgent: { type: String, required: false },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

export default mongoose.model<IFunnelEvent>('FunnelEvent', FunnelEventSchema);