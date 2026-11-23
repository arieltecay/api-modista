import type { CouponRejection } from './types.js';

export const COUPON_NOT_VALID_MESSAGE = 'El cupón no es válido para este curso';

/**
 * What the buyer is told. A coupon that ended or ran out is useless to anyone, so saying so reveals nothing worth
 * guessing; every other reason (unknown code, paused, not started yet, other course, price too low) reads the same,
 * so codes and upcoming promotions cannot be probed.
 */
export const couponRejectionMessage = (reason?: CouponRejection): string => {
  if (reason === 'expired') return 'Este cupón ya venció';
  if (reason === 'exhausted') return 'Este cupón ya no tiene lugares disponibles';
  return COUPON_NOT_VALID_MESSAGE;
};
