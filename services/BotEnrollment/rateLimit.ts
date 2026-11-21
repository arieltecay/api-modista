import BotLookupAttempt from '../../models/BotLookupAttempt/index.js';

export const MAX_LOOKUPS_PER_HOUR = 6;
const WINDOW_MS = 60 * 60_000;

/**
 * Registra una consulta de inscripción y dice si el remitente sigue dentro del tope por hora.
 * Inserta primero y cuenta después: así las consultas simultáneas no pasan todas por el mismo conteo.
 */
export const consumeLookupAttempt = async (platform: 'instagram' | 'whatsapp', platformId: string): Promise<boolean> => {
  const attempt = await BotLookupAttempt.create({ platform, platformId });
  const since = new Date(Date.now() - WINDOW_MS);
  const rank = await BotLookupAttempt.countDocuments({ platform, platformId, _id: { $lte: attempt._id }, createdAt: { $gte: since } });
  return rank <= MAX_LOOKUPS_PER_HOUR;
};
