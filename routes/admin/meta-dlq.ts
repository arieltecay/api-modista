import { Router } from 'express';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';
import MetaEventDlq from '../../models/MetaEventDlq.js';
import { logError } from '../../services/logger.js';

const router: Router = Router();

/**
 * DELETE /api/admin/meta-dlq/cleanup
 * Limpia eventos viejos del DLQ de Meta CAPI
 * Query params:
 *   - olderThanHours: eliminar eventos creados hace más de X horas (default: 24)
 *   - eventName: filtrar por nombre de evento (opcional)
 */
router.delete('/cleanup', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const olderThanHours = parseInt(req.query.olderThanHours as string) || 24;
    const eventName = req.query.eventName as string | undefined;

    const cutoffDate = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

    const filter: Record<string, unknown> = {
      createdAt: { $lt: cutoffDate },
    };

    if (eventName) {
      filter.eventName = eventName;
    }

    const result = await MetaEventDlq.deleteMany(filter);

    res.json({
      success: true,
      deletedCount: result.deletedCount,
      cutoffDate: cutoffDate.toISOString(),
      filter: {
        olderThanHours,
        eventName: eventName || 'all',
      },
    });
  } catch (error) {
    logError('metaDlqCleanup', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ success: false, message: 'Error al limpiar DLQ' });
  }
});

/**
 * GET /api/admin/meta-dlq/stats
 * Estadísticas del DLQ de Meta CAPI
 */
router.get('/stats', authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const total = await MetaEventDlq.countDocuments();
    const pending = await MetaEventDlq.countDocuments({ status: 'pending' });
    const sent = await MetaEventDlq.countDocuments({ status: 'sent' });
    const failed = await MetaEventDlq.countDocuments({ status: 'failed' });
    const exhausted = await MetaEventDlq.countDocuments({ status: 'exhausted' });

    const byEventName = await MetaEventDlq.aggregate([
      { $group: { _id: '$eventName', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    const oldestPending = await MetaEventDlq.findOne({ status: 'pending' })
      .sort({ createdAt: 1 })
      .select('createdAt eventName eventId')
      .lean();

    res.json({
      success: true,
      stats: {
        total,
        pending,
        sent,
        failed,
        exhausted,
        byEventName,
        oldestPending,
      },
    });
  } catch (error) {
    logError('metaDlqStats', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ success: false, message: 'Error al obtener stats del DLQ' });
  }
});

export default router;
