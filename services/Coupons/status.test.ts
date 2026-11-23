import assert from 'node:assert/strict';
import test from 'node:test';
import { couponStatus } from './status.js';
import type { CouponRules } from './types.js';

const NOW = new Date('2026-11-23T15:00:00Z');

const coupon = (overrides: Partial<CouponRules> = {}): CouponRules => ({
  type: 'percent',
  value: 20,
  courseId: null,
  startsAt: new Date('2026-11-01T00:00:00Z'),
  endsAt: new Date('2026-11-30T23:59:59Z'),
  maxUses: null,
  usedCount: 0,
  active: true,
  ...overrides,
});

test('a coupon inside its window with uses left is active', () => {
  assert.equal(couponStatus(coupon(), NOW), 'active');
});

test('a paused coupon is paused whatever its dates say', () => {
  assert.equal(couponStatus(coupon({ active: false }), NOW), 'paused');
  assert.equal(couponStatus(coupon({ active: false, endsAt: new Date('2026-01-01T00:00:00Z') }), NOW), 'paused');
});

test('before the start it is scheduled and after the end it is expired', () => {
  assert.equal(couponStatus(coupon({ startsAt: new Date('2026-12-01T00:00:00Z'), endsAt: new Date('2026-12-31T00:00:00Z') }), NOW), 'scheduled');
  assert.equal(couponStatus(coupon({ startsAt: new Date('2026-01-01T00:00:00Z'), endsAt: new Date('2026-01-31T00:00:00Z') }), NOW), 'expired');
});

test('a coupon that used all its uses inside its window is exhausted', () => {
  assert.equal(couponStatus(coupon({ maxUses: 3, usedCount: 3 }), NOW), 'exhausted');
  assert.equal(couponStatus(coupon({ maxUses: 3, usedCount: 2 }), NOW), 'active');
});
