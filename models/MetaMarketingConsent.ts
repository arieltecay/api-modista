import { Schema, model, Document } from 'mongoose';

export interface IMetaMarketingConsent extends Document {
  sessionId: string;
  marketingConsent: boolean;
  policyVersion: string;
  consentAt: Date;
}

const MetaMarketingConsentSchema = new Schema<IMetaMarketingConsent>({
  sessionId: { type: String, required: true, unique: true, index: true },
  marketingConsent: { type: Boolean, required: true, default: false },
  policyVersion: { type: String, required: true },
  consentAt: { type: Date, required: true, default: Date.now },
}, { timestamps: true });

MetaMarketingConsentSchema.index({ consentAt: 1 }, { expireAfterSeconds: 31_536_000 });

const MetaMarketingConsent = model<IMetaMarketingConsent>('MetaMarketingConsent', MetaMarketingConsentSchema);
export default MetaMarketingConsent;
