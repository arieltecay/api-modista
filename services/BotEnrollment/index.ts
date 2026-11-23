import Inscription from '../../models/Inscription.js';
import ConversationMessage from '../../models/ConversationMessage.js';
import { getEnrollmentConfig } from './config.js';
import { consumeLookupAttempt } from './rateLimit.js';
import { renderEnrollmentAnswer } from './templates.js';

type Platform = 'whatsapp' | 'instagram';
const emailPattern = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i;
const phonePattern = /(?:\+?\d[\d\s().-]{8,}\d)/;
const digits = (value: string) => value.replace(/\D/g, '');
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const classifyEnrollmentMessage = (text: string): 'enrollment' | 'other' => {
  if (/inscripci[oó]n|inscripto|inscripta|me inscrib[ií]|estoy anotad[ao]|qued[eé] anotad[ao]|mi curso|mi reserva|mi pago|ya pag[ué]|ya transfer[ií]|comprobante/i.test(text)) return 'enrollment';
  return 'other';
};

export const answerEnrollmentMessage = async (platform: Platform, platformId: string, text: string): Promise<string | null> => {
  const { whatsappLookupEnabled, templates } = await getEnrollmentConfig();
  if (platform === 'whatsapp' && !whatsappLookupEnabled) return null;
  const recent = await ConversationMessage.find({ platform, platform_id: platformId, direction: 'inbound', kind: { $exists: false }, timestamp: { $gte: new Date(Date.now() - 10 * 60_000) } })
    .sort({ timestamp: -1 }).limit(5).select('body').lean();
  const context = [text, ...recent.map(message => message.body)].join(' ');
  // Un número solo (p. ej. un rango de precios) no es dato de contacto: hace falta un email, ahora o en los mensajes recientes.
  const hasContactData = platform === 'instagram' && emailPattern.test(context);
  if (classifyEnrollmentMessage(context) !== 'enrollment' && !hasContactData) return null;
  const email = context.match(emailPattern)?.[0]?.toLowerCase();
  const suppliedPhone = platform === 'whatsapp' ? digits(platformId) : digits(context.replace(emailPattern, ' ').match(phonePattern)?.[0] ?? '');
  if (platform === 'instagram' && (!email || suppliedPhone.length < 10)) {
    return templates.askContact;
  }
  if (platform === 'whatsapp' && suppliedPhone.length < 10) return 'No pude identificar este número para consultar inscripciones.';

  if (platform === 'instagram' && !(await consumeLookupAttempt(platform, platformId))) return templates.rateLimited;

  const query = email ? { email: { $regex: `^${escapeRegex(email)}$`, $options: 'i' } } : { celular: { $regex: suppliedPhone.slice(-8).split('').join('\\D*') + '$' } };
  const candidates = await Inscription.find(query).select('celular courseTitle paymentStatus').limit(30).lean();
  const matches = candidates.filter(row => {
    const stored = digits(row.celular);
    return stored.length >= 10 && stored.slice(-10) === suppliedPhone.slice(-10);
  });
  if (!matches.length) return platform === 'whatsapp' ? null : templates.notFound;
  return renderEnrollmentAnswer(templates, matches);
};
