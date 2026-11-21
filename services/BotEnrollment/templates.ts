import type { EnrollmentTemplateKey, EnrollmentTemplates } from './types.js';

export const DEFAULT_ENROLLMENT_TEMPLATES: EnrollmentTemplates = {
  header: 'Encontré estas inscripciones:',
  paid: '• {curso}: figura como pagada.',
  partial: '• {curso}: registra un pago parcial.',
  pending: '• {curso}: tiene el pago pendiente de confirmación.',
  review: '• {curso}: tiene un estado pendiente de revisión.',
  footer: 'Este es el estado registrado actualmente; un pago reciente puede tardar en reflejarse.',
  notFound: 'No encontré una inscripción con esos datos. Revisá el email y el celular que ingresaste al inscribirte.',
  askContact: 'Para consultar tu inscripción por acá, indicame el email y el celular que usaste al inscribirte. Solo te diré el curso y el estado registrado.',
  rateLimited: 'Hiciste varias consultas seguidas. Por seguridad no puedo seguir consultando por acá; te va a responder una persona del equipo.',
};

/** Plantillas de línea: una por estado de pago, y deben nombrar el curso. */
export const STATUS_TEMPLATE_KEYS: EnrollmentTemplateKey[] = ['paid', 'partial', 'pending', 'review'];

/** El único dato de inscripción que una plantilla puede insertar. */
export const COURSE_PLACEHOLDER = '{curso}';

export const hasUnknownPlaceholder = (template: string): boolean => /\{(?!curso\})[^}]*\}/.test(template);

export const renderLine = (template: string, courseTitle: string): string =>
  template.split(COURSE_PLACEHOLDER).join(courseTitle);

const STATUS_KEY: Record<string, EnrollmentTemplateKey> = { paid: 'paid', partial: 'partial', pending: 'pending' };

export const renderEnrollmentAnswer = (
  templates: EnrollmentTemplates,
  rows: Array<{ courseTitle: string; paymentStatus: string }>,
): string => {
  const lines = rows.map(row => renderLine(templates[STATUS_KEY[row.paymentStatus] ?? 'review'], row.courseTitle));
  return [templates.header, ...lines, templates.footer].filter(part => part.trim()).join('\n');
};
