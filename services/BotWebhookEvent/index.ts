import BotWebhookEvent from '../../models/BotWebhookEvent/index.js';
import { logger } from '../logger.js';

type Platform = 'instagram' | 'whatsapp';

const MAX_ATTEMPTS = 3;
const STALE_CLAIM_MS = 2 * 60_000;

export const processBotWebhookMessage = async (
  platform: Platform,
  messageId: string,
  processMessage: () => Promise<void>,
): Promise<void> => {
  // Sin el índice único dos entregas simultáneas podrían crear el mismo evento.
  await BotWebhookEvent.init();
  const claimedAt = new Date();
  const staleBefore = new Date(claimedAt.getTime() - STALE_CLAIM_MS);
  let claim = await BotWebhookEvent.findOneAndUpdate(
    {
      platform,
      messageId,
      $or: [
        { status: 'failed', attempts: { $lt: MAX_ATTEMPTS } },
        { status: 'processing', claimedAt: { $lt: staleBefore }, attempts: { $lt: MAX_ATTEMPTS } },
      ],
    },
    { $set: { status: 'processing', claimedAt }, $inc: { attempts: 1 } },
    { new: true },
  );

  if (!claim) {
    try {
      claim = await BotWebhookEvent.create({ platform, messageId, status: 'processing', claimedAt });
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 11000) throw error;
      const existing = await BotWebhookEvent.findOne({ platform, messageId }).select('status attempts').lean();
      if (existing?.status === 'complete') return;
      if (existing?.status === 'failed' && (existing.attempts ?? 1) >= MAX_ATTEMPTS) {
        logger.warn('[Bot Webhook] Mensaje descartado tras reintentos fallidos', { platform, messageId });
        return;
      }
      throw new Error('El mensaje ya se está procesando');
    }
  }

  // Solo el dueño vigente del reclamo puede cerrarlo: otro worker pudo tomarlo si este tardó demasiado.
  const ownClaim = { _id: claim._id, claimedAt };
  try {
    await processMessage();
    await BotWebhookEvent.updateOne(ownClaim, { $set: { status: 'complete' } });
  } catch (error) {
    await BotWebhookEvent.updateOne(ownClaim, { $set: { status: 'failed' } });
    throw error;
  }
};
