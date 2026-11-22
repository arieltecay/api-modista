import BotLookupAttempt from '../../models/BotLookupAttempt/index.js';

export const MAX_LOOKUPS_PER_HOUR = 6;
const HOUR_MS = 60 * 60_000;
const isDuplicateKey = (error: unknown) => error instanceof Error && 'code' in error && error.code === 11000;

/**
 * Cuenta una consulta de inscripción en el contador de la hora actual y dice si sigue dentro del tope.
 * El incremento con upsert es atómico: las consultas simultáneas no pueden pasar todas por el mismo conteo.
 * Ventana fija por hora: en el cambio de hora una cuenta puede hacer hasta el doble de consultas.
 */
export const consumeLookupAttempt = async (platform: 'instagram' | 'whatsapp', platformId: string): Promise<boolean> => {
  const windowStart = new Date(Math.floor(Date.now() / HOUR_MS) * HOUR_MS);
  const increment = () => BotLookupAttempt.findOneAndUpdate(
    { platform, platformId, windowStart },
    { $inc: { count: 1 } },
    { upsert: true, new: true },
  );
  try {
    return (await increment())!.count <= MAX_LOOKUPS_PER_HOUR;
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    return (await increment())!.count <= MAX_LOOKUPS_PER_HOUR;
  }
};
