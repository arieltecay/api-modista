import BotInstruction from '../../models/BotInstruction.js';

export type InstagramResponseMode = 'gemini' | 'fixed';

type InstagramInstruction = {
  title: string;
  content: string;
  instagramEnrollmentLookup: boolean;
  instagramResponseMode: InstagramResponseMode;
  instagramFixedResponse: string;
};

const normalize = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const matchesPhrase = (message: string, phrase: string): boolean => {
  const normalized = normalize(phrase);
  return normalized.length > 0 && new RegExp(`(?<![a-z0-9])${escapeRegex(normalized)}`).test(message);
};

export type InstagramChannel = 'dm' | 'comment';

/** Cada canal tiene su propio interruptor: activar los DMs de un bloque nunca habilita comentarios. */
const CHANNEL_SWITCH = { dm: 'instagramAutoReply', comment: 'instagramCommentReply' } as const;

export const getInstagramReplyPolicy = async (text: string, channel: InstagramChannel = 'dm'): Promise<InstagramInstruction[]> => {
  const instructions = await BotInstruction.find({ isActive: true, [CHANNEL_SWITCH[channel]]: true })
    .sort({ order: 1, _id: 1 }).select('title content instagramKeywords instagramEnrollmentLookup instagramResponseMode instagramFixedResponse').lean();
  const message = normalize(text);
  return instructions
    .filter(instruction => (instruction.instagramKeywords ?? []).some(keyword => matchesPhrase(message, keyword)))
    .map(instruction => ({
      title: instruction.title,
      content: instruction.content,
      instagramEnrollmentLookup: instruction.instagramEnrollmentLookup,
      // Las reglas guardadas antes de existir el modo no tienen el campo: siguen con Gemini.
      instagramResponseMode: instruction.instagramResponseMode === 'fixed' ? 'fixed' : 'gemini',
      instagramFixedResponse: instruction.instagramFixedResponse ?? '',
    }));
};

/** Texto de la primera regla fija coincidente (ya vienen por orden); sin regla fija, Gemini redacta. */
export const fixedReplyOf = (instructions: InstagramInstruction[]): string | undefined =>
  instructions.find(rule => rule.instagramResponseMode === 'fixed' && rule.instagramFixedResponse.trim())?.instagramFixedResponse;
