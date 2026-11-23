import type { InstagramCommentValue } from '../../types/instagram-official.js';
import ConversationMessage from '../../models/ConversationMessage.js';
import { consumeHourlyAttempt, releaseHourlyAttempt } from '../BotEnrollment/rateLimit.js';
import { fixedReplyOf, geminiRulesOf, getInstagramReplyPolicy } from '../BotReplyPolicy/index.js';
import { generateAIResponse } from '../gemini-service.js';
import { logger } from '../logger.js';
import { sendInstagramPrivateReply } from './instagram-private-reply-service.js';

/** Instagram limita el mensaje a ~1000 bytes; un texto más largo sería rechazado como error permanente. */
const MAX_REPLY_CHARS = 900;
export const COMMENT_REPLIES_PER_USER_PER_HOUR = 3;
export const COMMENT_REPLIES_PER_ACCOUNT_PER_HOUR = 30;

export interface InstagramCommentEvent {
  commentId: string;
  from: string;
  text: string;
}

export type ParsedComment = { event: InstagramCommentEvent } | { ignored: string };

/**
 * Valida un cambio `comments`. `live_comments` queda fuera: su ventana (solo durante la transmisión) es otra.
 * Solo comentarios de primer nivel de otras personas: ignora los propios y las respuestas a otro comentario.
 */
export const parseCommentChange = (field: string, value: InstagramCommentValue | undefined, ownAccountIds: Array<string | undefined>): ParsedComment => {
  if (field !== 'comments') return { ignored: `change:${field}` };
  const commentId = value?.id ?? value?.comment_id;
  const from = value?.from?.id;
  const text = value?.text?.trim();
  if (!commentId || !from || !text) return { ignored: 'comment_incomplete' };
  if (ownAccountIds.includes(from)) return { ignored: 'comment_own' };
  if (value?.parent_id) return { ignored: 'comment_reply' };
  return { event: { commentId, from, text } };
};

/** Clave de idempotencia con prefijo propio para que un ID de comentario nunca choque con un ID de mensaje. */
export const commentEventKey = (commentId: string): string => `comment:${commentId}`;

/**
 * Guarda el comentario para el panel y, si una regla habilitada para comentarios coincide, envía una única respuesta privada.
 * Lanza ante fallos transitorios para que Meta reintente; los permanentes quedan registrados como respuesta fallida.
 */
export const processInstagramComment = async ({ commentId, from, text }: InstagramCommentEvent): Promise<void> => {
  await ConversationMessage.updateOne(
    { platform: 'instagram', externalMessageId: commentEventKey(commentId) },
    { $setOnInsert: { platform_id: from, body: text, direction: 'inbound', status: 'delivered', kind: 'comment', commentId } },
    { upsert: true },
  );

  const matchedInstructions = await getInstagramReplyPolicy(text, 'comment');
  // Una regla fija coincidente se envía tal cual; si no hay, Gemini redacta solo con reglas de Gemini.
  const fixedReply = fixedReplyOf(matchedInstructions);
  const geminiRules = geminiRulesOf(matchedInstructions);
  if (!fixedReply && geminiRules.length === 0) return;

  const userKey = `comment-user:${from}`;
  const withinUserCap = await consumeHourlyAttempt('instagram', userKey, COMMENT_REPLIES_PER_USER_PER_HOUR);
  const withinAccountCap = withinUserCap && await consumeHourlyAttempt('instagram', 'comment-account', COMMENT_REPLIES_PER_ACCOUNT_PER_HOUR);
  if (!withinAccountCap) {
    if (withinUserCap) await releaseHourlyAttempt('instagram', userKey);
    logger.warn('[Instagram Comment] Tope horario alcanzado; el comentario queda para atención humana', { scope: withinUserCap ? 'account' : 'user' });
    return;
  }

  // Si falla algo transitorio Meta reintenta el evento: se devuelve el cupo para que el reintento no cuente doble.
  const releaseAllowance = () => Promise.all([releaseHourlyAttempt('instagram', userKey), releaseHourlyAttempt('instagram', 'comment-account')]);
  let reply: string;
  let result: Awaited<ReturnType<typeof sendInstagramPrivateReply>>;
  try {
    // Las instrucciones de inscripción no se usan: un comentario es público y no autentica a la persona.
    // El texto fijo ya está validado y sale entero; lo generado se recorta por caracteres para no partir un emoji.
    reply = fixedReply ?? [...await generateAIResponse(text, from, 'instagram', geminiRules, 'comment')].slice(0, MAX_REPLY_CHARS).join('');
    result = await sendInstagramPrivateReply(commentId, reply);
  } catch (error) {
    await releaseAllowance();
    throw error;
  }
  if (result.status === 'transient') {
    await releaseAllowance();
    throw new Error('No se pudo enviar la respuesta privada al comentario');
  }

  await ConversationMessage.create({
    platform: 'instagram', platform_id: from, body: reply, direction: 'outbound', kind: 'private_reply', commentId,
    status: result.status === 'sent' ? 'sent' : 'failed',
  });
};
