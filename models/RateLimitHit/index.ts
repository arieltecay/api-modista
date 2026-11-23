import mongoose, { Schema } from 'mongoose';

const RateLimitHitSchema = new Schema({
  /** `<limiter prefix>:<client key>`; one row per client and limiter, shared by every server instance. */
  key: { type: String, required: true, unique: true },
  hits: { type: Number, required: true },
  /** End of the counting window; the TTL index below deletes the row once it passes. */
  resetAt: { type: Date, required: true },
});

RateLimitHitSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('RateLimitHit', RateLimitHitSchema);
