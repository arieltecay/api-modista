import mongoose, { Schema } from 'mongoose';
import { COUPON_MAX_USES_LIMIT, COUPON_CODE_MESSAGE, COUPON_CODE_PATTERN, COUPON_MAX_PERCENT, COUPON_PERCENT_MESSAGE, COUPON_WINDOW_MESSAGE } from './rules.js';

const CouponSchema = new Schema(
  {
    /** Stored trimmed and uppercase; the unique index makes a code usable by one coupon only. */
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      match: [COUPON_CODE_PATTERN, COUPON_CODE_MESSAGE],
    },
    type: { type: String, enum: ['percent', 'fixed'], required: true },
    /** Percent (1-99) or whole ARS pesos, depending on `type`. */
    value: { type: Number, required: true },
    /** Course uuid (same key as `Inscription.courseId`); null applies to every course. */
    courseId: { type: String, default: null },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    /** Total uses allowed (paid inscriptions); null means unlimited. */
    maxUses: { type: Number, default: null, min: 1, max: COUPON_MAX_USES_LIMIT },
    /** Seats held by inscriptions still being paid; admitted atomically (see services/Coupons/reservation.ts). */
    seats: {
      type: [{ _id: false, inscriptionId: { type: Schema.Types.ObjectId, required: true }, until: { type: Date, required: true } }],
      default: [],
    },
    /** Uses confirmed by an approved payment. */
    usedCount: { type: Number, default: 0, min: 0 },
    /** Paused coupons are kept for the history instead of deleted. */
    active: { type: Boolean, default: true },
    createdBy: { type: String },
  },
  { timestamps: true }
);

CouponSchema.pre('validate', function () {
  if (!Number.isInteger(this.value) || this.value < 1) {
    this.invalidate('value', 'El valor debe ser un entero positivo');
  } else if (this.type === 'percent' && this.value > COUPON_MAX_PERCENT) {
    this.invalidate('value', COUPON_PERCENT_MESSAGE);
  }
  if (this.startsAt && this.endsAt && this.endsAt < this.startsAt) {
    this.invalidate('endsAt', COUPON_WINDOW_MESSAGE);
  }
});

CouponSchema.index({ createdAt: -1 });

export default mongoose.model('Coupon', CouponSchema);
