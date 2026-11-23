import { z } from 'zod';
import {
  COUPON_CODE_INPUT_PATTERN,
  COUPON_CODE_MAX_LENGTH,
  COUPON_CODE_MESSAGE,
  COUPON_MAX_PERCENT,
  COUPON_MAX_USES_LIMIT,
  COUPON_PERCENT_MESSAGE,
  COUPON_WINDOW_MESSAGE,
} from '../../models/Coupon/rules.js';
import { COUPON_STATUSES } from '../../services/Coupons/status.js';


const courseId = z.string().trim().min(1).max(64);
const maxUses = z.number().int().min(1).max(COUPON_MAX_USES_LIMIT).nullable();

export const createBody = z
  .strictObject({
    code: z.string().trim().regex(COUPON_CODE_INPUT_PATTERN, COUPON_CODE_MESSAGE).toUpperCase(),
    type: z.enum(['percent', 'fixed']),
    value: z.number().int().min(1),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    courseId: courseId.nullable().default(null),
    maxUses: maxUses.default(null),
  })
  .superRefine((data, context) => {
    if (data.type === 'percent' && data.value > COUPON_MAX_PERCENT) {
      context.addIssue({ code: 'custom', path: ['value'], message: COUPON_PERCENT_MESSAGE });
    }
    if (data.endsAt < data.startsAt) {
      context.addIssue({ code: 'custom', path: ['endsAt'], message: COUPON_WINDOW_MESSAGE });
    }
  });

/** Only what can change without rewriting the history of a coupon: pause it, move its dates or its cap. */
export const updateBody = z
  .strictObject({
    active: z.boolean(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    maxUses,
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: 'No hay cambios para guardar' });

export const listQuery = z.object({
  status: z.enum(COUPON_STATUSES).optional(),
  courseId: courseId.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const validateBody = z.object({
  code: z.string().trim().min(1).max(COUPON_CODE_MAX_LENGTH),
  courseId,
});

/** Only the course uuid or id: the numeric position of the legacy lookup loads every course on each call. */
export const availabilityQuery = z.object({ courseId: courseId.refine((value) => !/^\d+$/.test(value), 'Identificador de curso inválido') });
