import assert from 'node:assert/strict';
import test from 'node:test';
import { computeDiscount, evaluateCoupon } from './discount.js';
import type { CouponRules } from './types.js';

const NOW = new Date('2026-11-23T15:00:00Z');

const rules = (overrides: Partial<CouponRules> = {}): CouponRules => ({
  type: 'percent',
  value: 20,
  courseId: 'course-uuid',
  startsAt: new Date('2026-11-01T00:00:00Z'),
  endsAt: new Date('2026-11-30T23:59:59Z'),
  maxUses: null,
  usedCount: 0,
  active: true,
  ...overrides,
});

const evaluate = (coupon: CouponRules, price = 20000, courseId = 'course-uuid', now = NOW) =>
  evaluateCoupon(coupon, { courseId, price, now });

test('a percent coupon takes that share off the list price, rounded to whole pesos', () => {
  assert.equal(computeDiscount({ type: 'percent', value: 20 }, 20900), 4180);
  assert.equal(computeDiscount({ type: 'percent', value: 15 }, 20901), 3135); // 3135.15 -> 3135
  assert.equal(computeDiscount({ type: 'percent', value: 33 }, 1000), 330);
});

test('a fixed coupon takes exactly that amount off', () => {
  assert.equal(computeDiscount({ type: 'fixed', value: 500 }, 20900), 500);
});

test('a valid coupon returns the discount and the final price', () => {
  const result = evaluate(rules({ type: 'fixed', value: 500 }), 20900);

  assert.deepEqual(result, { valid: true, discountAmount: 500, finalPrice: 20400 });
});

test('a coupon without a course applies to every course', () => {
  assert.equal(evaluate(rules({ courseId: null }), 20000, 'any-other-course').valid, true);
});

test('a coupon of another course is rejected', () => {
  assert.deepEqual(evaluate(rules(), 20000, 'other-course'), { valid: false, reason: 'wrong_course' });
});

test('a paused coupon is rejected', () => {
  assert.deepEqual(evaluate(rules({ active: false })), { valid: false, reason: 'inactive' });
});

test('the validity window includes both limits and rejects outside of it', () => {
  const coupon = rules();

  assert.equal(evaluate(coupon, 20000, 'course-uuid', coupon.startsAt).valid, true);
  assert.equal(evaluate(coupon, 20000, 'course-uuid', coupon.endsAt).valid, true);
  assert.deepEqual(evaluate(coupon, 20000, 'course-uuid', new Date(coupon.startsAt.getTime() - 1)), {
    valid: false,
    reason: 'not_started',
  });
  assert.deepEqual(evaluate(coupon, 20000, 'course-uuid', new Date(coupon.endsAt.getTime() + 1)), {
    valid: false,
    reason: 'expired',
  });
});

test('a coupon whose uses reached the cap is exhausted, one below the cap still works', () => {
  assert.deepEqual(evaluate(rules({ maxUses: 5, usedCount: 5 })), { valid: false, reason: 'exhausted' });
  assert.equal(evaluate(rules({ maxUses: 5, usedCount: 4 })).valid, true);
  assert.equal(evaluate(rules({ maxUses: null, usedCount: 9999 })).valid, true);
});

test('a discount that would leave the course free or negative is rejected', () => {
  assert.deepEqual(evaluate(rules({ type: 'fixed', value: 20000 }), 20000), { valid: false, reason: 'not_applicable' });
  assert.deepEqual(evaluate(rules({ type: 'fixed', value: 30000 }), 20000), { valid: false, reason: 'not_applicable' });
  assert.deepEqual(evaluate(rules({ type: 'percent', value: 99 }), 1), { valid: false, reason: 'not_applicable' });
});

test('a free course never takes a coupon', () => {
  assert.deepEqual(evaluate(rules(), 0), { valid: false, reason: 'not_applicable' });
});

test('invariant: for any valid coupon the final price is a whole number between 1 and the list price', () => {
  for (let price = 1; price <= 500; price += 7) {
    for (const value of [1, 10, 33, 50, 99]) {
      const result = evaluate(rules({ type: 'percent', value }), price);
      if (!result.valid) continue;
      assert.ok(Number.isInteger(result.finalPrice));
      assert.ok(result.finalPrice >= 1 && result.finalPrice <= price);
      assert.equal(result.finalPrice + result.discountAmount, price);
    }
  }
});
