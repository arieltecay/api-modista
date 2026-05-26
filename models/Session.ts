import { Schema, model, Document } from 'mongoose';

export interface ISession extends Document {
  sessionId: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  referrer?: string;
  device?: string;
  landingPage: string;
  userAgent?: string;
  ip?: string;
  createdAt: Date;
  lastActivityAt: Date;
}

const SessionSchema = new Schema<ISession>({
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  utmSource: { type: String, trim: true },
  utmMedium: { type: String, trim: true },
  utmCampaign: { type: String, trim: true },
  utmTerm: { type: String, trim: true },
  utmContent: { type: String, trim: true },
  referrer: { type: String, trim: true },
  device: { type: String, trim: true },
  landingPage: { type: String, required: true },
  userAgent: { type: String },
  ip: { type: String },
  createdAt: { type: Date, default: Date.now },
  lastActivityAt: { type: Date, default: Date.now },
});

SessionSchema.index({ createdAt: -1 });
SessionSchema.index({ utmMedium: 1, createdAt: -1 });
SessionSchema.index({ utmCampaign: 1 });

const Session = model<ISession>('Session', SessionSchema);

export default Session;
