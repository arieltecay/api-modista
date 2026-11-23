import type { CouponEvaluation, CouponPurchase, CouponRules } from './types.js';

/** Whole pesos taken off `price` by a coupon rule. */
export const computeDiscount = ({ type, value }: Pick<CouponRules, 'type' | 'value'>, price: number): number =>
  type === 'percent' ? Math.round((price * value) / 100) : value;

/** Decides whether a coupon applies to a purchase; the server is the only place that prices it. */
export const evaluateCoupon = (coupon: CouponRules, { courseId, price, now }: CouponPurchase): CouponEvaluation => {
  if (!coupon.active) return { valid: false, reason: 'inactive' };
  if (coupon.courseId && coupon.courseId !== courseId) return { valid: false, reason: 'wrong_course' };
  if (now < coupon.startsAt) return { valid: false, reason: 'not_started' };
  if (now > coupon.endsAt) return { valid: false, reason: 'expired' };
  if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) return { valid: false, reason: 'exhausted' };

  const discountAmount = computeDiscount(coupon, price);
  const finalPrice = price - discountAmount;
  if (price <= 0 || finalPrice < 1) return { valid: false, reason: 'not_applicable' };

  return { valid: true, discountAmount, finalPrice };
};
