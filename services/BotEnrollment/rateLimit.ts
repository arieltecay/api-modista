import BotLookupAttempt from '../../models/BotLookupAttempt/index.js';

export const MAX_LOOKUPS_PER_HOUR = 6;
const HOUR_MS = 60 * 60_000;
const isDuplicateKey = (error: unknown) => error instanceof Error && 'code' in error && error.code === 11000;

/**
 * Cuenta una consulta de inscripción en el contador de la hora actual y dice si sigue dentro del tope.
 * El incremento con upsert es atómico: las consultas simultáneas no pueden pasar todas por el mismo conteo.
 * Ventana fija por hora: en el cambio de hora una cuenta puede hacer hasta el doble de consultas.
 */
export const consumeHourlyAttempt = async (platform: 'instagram' | 'whatsapp', platformId: string, maxPerHour: number): Promise<boolean> => {
  const windowStart = new Date(Math.floor(Date.now() / HOUR_MS) * HOUR_MS);
  const increment = () => BotLookupAttempt.findOneAndUpdate(
    { platform, platformId, windowStart },
    { $inc: { count: 1 } },
    { upsert: true, new: true },
  );
  try {
    return (await increment())!.count <= maxPerHour;
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    return (await increment())!.count <= maxPerHour;
  }
};

/** Devuelve un intento de la hora actual (p. ej. cuando el envío falló por un error transitorio y Meta reintentará). */
export const releaseHourlyAttempt = async (platform: 'instagram' | 'whatsapp', platformId: string): Promise<void> => {
  const windowStart = new Date(Math.floor(Date.now() / HOUR_MS) * HOUR_MS);
  await BotLookupAttempt.updateOne({ platform, platformId, windowStart, count: { $gt: 0 } }, { $inc: { count: -1 } });
};

export const consumeLookupAttempt = (platform: 'instagram' | 'whatsapp', platformId: string): Promise<boolean> => consumeHourlyAttempt(platform, platformId, MAX_LOOKUPS_PER_HOUR);
