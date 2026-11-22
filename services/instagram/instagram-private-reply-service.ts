import axios from 'axios';
import { logger } from '../logger.js';

/**
 * Respuesta privada a un comentario (Instagram API con Instagram Login).
 * Un solo mensaje por comentario, dentro de los 7 días. Usa las credenciales de Instagram Login
 * (`META_INSTAGRAM_ACCESS_TOKEN` debe incluir `instagram_business_manage_comments`).
 * https://developers.facebook.com/docs/instagram-platform/private-replies
 */
export type PrivateReplyResult =
  | { status: 'sent' }
  | { status: 'permanent'; httpStatus?: number; code?: number; subcode?: number; traceId?: string }
  | { status: 'transient'; httpStatus?: number };

const API_VERSION = process.env.META_INSTAGRAM_API_VERSION ?? 'v27.0';

export const sendInstagramPrivateReply = async (commentId: string, text: string): Promise<PrivateReplyResult> => {
  const token = process.env.META_INSTAGRAM_ACCESS_TOKEN;
  const igUserId = process.env.META_INSTAGRAM_USER_ID;
  if (!token || !igUserId) {
    logger.error('[Instagram Private Reply] Credenciales faltantes: META_INSTAGRAM_ACCESS_TOKEN o META_INSTAGRAM_USER_ID');
    return { status: 'permanent' };
  }

  try {
    await axios.post(
      `https://graph.instagram.com/${API_VERSION}/${igUserId}/messages`,
      { recipient: { comment_id: commentId }, message: { text } },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 10_000 },
    );
    return { status: 'sent' };
  } catch (error) {
    const response = (error as { response?: { status?: number; data?: { error?: { code?: number; error_subcode?: number; fbtrace_id?: string } } } }).response;
    const httpStatus = response?.status;
    const provider = response?.data?.error;
    // Solo se registran identificadores del error, nunca el mensaje de la excepción (podría incluir la credencial).
    logger.error('[Instagram Private Reply] Meta rechazó o no recibió la respuesta', { httpStatus, code: provider?.code, subcode: provider?.error_subcode, traceId: provider?.fbtrace_id });
    const permanent = httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 429;
    return permanent
      ? { status: 'permanent', httpStatus, code: provider?.code, subcode: provider?.error_subcode, traceId: provider?.fbtrace_id }
      : { status: 'transient', httpStatus };
  }
};
