import Inscription from '../../models/Inscription.js';
import ConversationMessage from '../../models/ConversationMessage.js';

type Platform = 'whatsapp' | 'instagram';
const emailPattern = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i;
const phonePattern = /(?:\+?\d[\d\s().-]{8,}\d)/;
const digits = (value: string) => value.replace(/\D/g, '');
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const classifyEnrollmentMessage = (text: string): 'enrollment' | 'other' => {
  if (/inscripci[oó]n|inscripto|inscripta|me inscrib[ií]|estoy anotad[ao]|qued[eé] anotad[ao]|mi curso|mi reserva|mi pago|ya pag[ué]|ya transfer[ií]|comprobante/i.test(text)) return 'enrollment';
  return 'other';
};

const statusLabel = (status: string): string => ({
  paid: 'figura como pagada', partial: 'registra un pago parcial', pending: 'tiene el pago pendiente de confirmación',
})[status] ?? 'tiene un estado pendiente de revisión';

export const answerEnrollmentMessage = async (platform: Platform, platformId: string, text: string): Promise<string | null> => {
  const recent = await ConversationMessage.find({ platform, platform_id: platformId, direction: 'inbound', timestamp: { $gte: new Date(Date.now() - 10 * 60_000) } })
    .sort({ timestamp: -1 }).limit(5).select('body').lean();
  const context = [text, ...recent.map(message => message.body)].join(' ');
  const hasContactData = platform === 'instagram' && (emailPattern.test(text) || phonePattern.test(text));
  if (classifyEnrollmentMessage(context) !== 'enrollment' && !hasContactData) return null;
  const email = context.match(emailPattern)?.[0]?.toLowerCase();
  const suppliedPhone = platform === 'whatsapp' ? digits(platformId) : digits(context.match(phonePattern)?.[0] ?? '');
  if (platform === 'instagram' && (!email || suppliedPhone.length < 10)) {
    return 'Para consultar tu inscripción por acá, indicame el email y el celular que usaste al inscribirte. Solo te diré el curso y el estado registrado.';
  }
  if (platform === 'whatsapp' && suppliedPhone.length < 10) return 'No pude identificar este número para consultar inscripciones.';

  const query = email ? { email: { $regex: `^${escapeRegex(email)}$`, $options: 'i' } } : { celular: { $regex: suppliedPhone.slice(-8).split('').join('\\D*') + '$' } };
  const candidates = await Inscription.find(query).select('celular courseTitle paymentStatus').limit(30).lean();
  const matches = candidates.filter(row => {
    const stored = digits(row.celular);
    return stored.length >= 10 && stored.slice(-10) === suppliedPhone.slice(-10);
  });
  if (!matches.length) return platform === 'whatsapp' ? null : 'No encontré una inscripción con esos datos. Revisá el email y el celular que ingresaste al inscribirte.';
  return `Encontré estas inscripciones:\n${matches.map(row => `• ${row.courseTitle}: ${statusLabel(row.paymentStatus)}.`).join('\n')}\nEste es el estado registrado actualmente; un pago reciente puede tardar en reflejarse.`;
};
