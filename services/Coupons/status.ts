import type { CouponRules } from './types.js';

export const COUPON_STATUSES = ['active', 'paused', 'scheduled', 'expired', 'exhausted'] as const;
export type CouponStatus = (typeof COUPON_STATUSES)[number];

const USES_LEFT = { $expr: { $lt: ['$usedCount', '$maxUses'] } };
const NO_USES_LEFT = { maxUses: { $ne: null }, $expr: { $gte: ['$usedCount', '$maxUses'] } };

/** One status per coupon; paused wins, then the dates, then the use cap. */
export const couponStatus = (coupon: CouponRules, now: Date): CouponStatus => {
  if (!coupon.active) return 'paused';
  if (now < coupon.startsAt) return 'scheduled';
  if (now > coupon.endsAt) return 'expired';
  if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) return 'exhausted';
  return 'active';
};

/** Mongo filter that selects exactly the coupons `couponStatus` would label with `status`. */
export const statusFilter = (status: CouponStatus, now: Date): Record<string, unknown> => {
  const inWindow = { startsAt: { $lte: now }, endsAt: { $gte: now } };
  switch (status) {
    case 'paused':
      return { active: false };
    case 'scheduled':
      return { active: true, startsAt: { $gt: now } };
    case 'expired':
      return { active: true, endsAt: { $lt: now } };
    case 'exhausted':
      return { active: true, ...inWindow, ...NO_USES_LEFT };
    case 'active':
      return { active: true, ...inWindow, $or: [{ maxUses: null }, USES_LEFT] };
  }
};
