import { z } from 'zod';
import { COURSE_PLACEHOLDER, DEFAULT_ENROLLMENT_TEMPLATES, STATUS_TEMPLATE_KEYS, hasUnknownPlaceholder } from '../../services/BotEnrollment/templates.js';

const text = z.string().trim().max(500).refine(value => !hasUnknownPlaceholder(value), `Solo se permite ${COURSE_PLACEHOLDER}`);
const required = text.min(1);
const withCourse = required.refine(value => value.includes(COURSE_PLACEHOLDER), `Debe incluir ${COURSE_PLACEHOLDER}`);

const shape = Object.fromEntries(
  Object.keys(DEFAULT_ENROLLMENT_TEMPLATES).map(key => [
    key,
    STATUS_TEMPLATE_KEYS.includes(key as never) ? withCourse : key === 'header' || key === 'footer' ? text : required,
  ]),
);

export const enrollmentConfigSchema = z.object({
  whatsappLookupEnabled: z.boolean(),
  templates: z.object(shape).partial().strict(),
}).partial();
