import BotInstruction from '../../models/BotInstruction.js';

type InstagramInstruction = {
  title: string;
  content: string;
  instagramEnrollmentLookup: boolean;
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
    .sort({ order: 1 }).select('title content instagramKeywords instagramEnrollmentLookup').lean();
  const message = normalize(text);
  return instructions
    .filter(instruction => (instruction.instagramKeywords ?? []).some(keyword => matchesPhrase(message, keyword)))
    .map(instruction => ({
      title: instruction.title,
      content: instruction.content,
      instagramEnrollmentLookup: instruction.instagramEnrollmentLookup,
    }));
};
