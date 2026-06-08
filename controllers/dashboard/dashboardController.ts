import { Request, Response } from 'express';
import Inscription from '../../models/Inscription.js';
import ConversationMessage from '../../models/ConversationMessage.js';


/**
 * Controller for Dashboard metrics and insights
 */

export const getGeneralStats = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    
    const query: any = {};
    if (startDate || endDate) {
      query.fechaInscripcion = {};
      if (startDate) {
        query.fechaInscripcion.$gte = new Date(startDate as string);
      }
      if (endDate) {
        const end = new Date(endDate as string);
        end.setUTCHours(23, 59, 59, 999);
        query.fechaInscripcion.$lte = end;
      }
    }

    console.log('[Dashboard] General Stats Query:', JSON.stringify(query));

    // Agregación para KPI Cards
    // Intentamos capturar tanto el historial nuevo como el depositAmount antiguo
    const stats = await Inscription.aggregate([
      { $match: query },
      {
        $project: {
          paymentStatus: 1,
          marketingSource: 1,
          depositAmount: 1,
          coursePrice: 1,
          paymentHistory: 1,
          // Calculamos el total pagado por documento para sumar luego
          totalPaidInDoc: {
            $let: {
              vars: {
                recordedAmount: {
                  $cond: [
                    { $and: [{ $isArray: '$paymentHistory' }, { $gt: [{ $size: '$paymentHistory' }, 0] }] },
                    { $sum: '$paymentHistory.amount' },
                    { $ifNull: ['$depositAmount', 0] }
                  ]
                }
              },
              in: {
                $cond: [
                  { $and: [{ $eq: ['$paymentStatus', 'paid'] }, { $eq: ['$$recordedAmount', 0] }] },
                  { $ifNull: ['$coursePrice', 0] },
                  '$$recordedAmount'
                ]
              }
            }
          }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalPaidInDoc' },
          totalInscriptions: { $sum: 1 },
          paidInscriptions: { 
            $sum: { $cond: [{ $eq: ['$paymentStatus', 'paid'] }, 1, 0] } 
          },
          organicInscriptions: { 
            $sum: { 
              $cond: [
                { 
                  $not: [
                    { $in: ['$marketingSource', ['instagram_paid', 'meta_ads', 'facebook_ads', 'fb_ads', 'social_paid']] }
                  ]
                }, 
                1, 0
              ] 
            } 
          },
          paidAdsInscriptions: { 
            $sum: { 
              $cond: [
                { $in: ['$marketingSource', ['instagram_paid', 'meta_ads', 'facebook_ads', 'fb_ads', 'social_paid']] },
                1, 0
              ] 
            } 
          }
        }
      }
    ]);

    const result = stats[0] || { 
      totalRevenue: 0, 
      totalInscriptions: 0, 
      paidInscriptions: 0, 
      organicInscriptions: 0, 
      paidAdsInscriptions: 0 
    };

    res.json({
      totalRevenue: result.totalRevenue,
      totalInscriptions: result.totalInscriptions,
      paidInscriptions: result.paidInscriptions,
      partialInscriptions: 0, // No lo usamos por ahora en el dashboard principal
      attribution: {
        organic: result.organicInscriptions,
        paidAds: result.paidAdsInscriptions
      }
    });
  } catch (error: any) {
    console.error('[Dashboard] Error in getGeneralStats:', error);
    res.status(500).json({ error: error.message });
  }
};

export const getCoursePerformance = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    
    const query: any = {};
    if (startDate || endDate) {
      query.fechaInscripcion = {};
      if (startDate) {
        query.fechaInscripcion.$gte = new Date(startDate as string);
      }
      if (endDate) {
        const end = new Date(endDate as string);
        end.setUTCHours(23, 59, 59, 999);
        query.fechaInscripcion.$lte = end;
      }
    }

    const performance = await Inscription.aggregate([
      { $match: query },
      {
        $project: {
          courseId: 1,
          courseTitle: 1,
          paymentStatus: 1,
          totalPaidInDoc: {
            $let: {
              vars: {
                recordedAmount: {
                  $cond: [
                    { $and: [{ $isArray: '$paymentHistory' }, { $gt: [{ $size: '$paymentHistory' }, 0] }] },
                    { $sum: '$paymentHistory.amount' },
                    { $ifNull: ['$depositAmount', 0] }
                  ]
                }
              },
              in: {
                $cond: [
                  { $and: [{ $eq: ['$paymentStatus', 'paid'] }, { $eq: ['$$recordedAmount', 0] }] },
                  { $ifNull: ['$coursePrice', 0] },
                  '$$recordedAmount'
                ]
              }
            }
          }
        }
      },
      {
        $group: {
          _id: '$courseId',
          courseTitle: { $first: '$courseTitle' },
          totalInscribed: { $sum: 1 },
          paidInscribed: { 
            $sum: { $cond: [{ $eq: ['$paymentStatus', 'paid'] }, 1, 0] } 
          },
          revenue: { $sum: '$totalPaidInDoc' }
        }
      },
      { $sort: { totalInscribed: -1 } }
    ]);

    res.json(performance);
  } catch (error: any) {
    console.error('[Dashboard] Error in getCoursePerformance:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Gets WhatsApp message stats from local DB
 * - Message counts (sent/delivered/read) from ConversationMessage collection
 * - Cost data is not available (WABA does not expose analytics endpoint)
 */
export const getMetaWhatsAppStats = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    const start = (startDate as string) || '';
    const end = (endDate as string) || '';

    const dateQuery: any = {};
    if (start || end) {
      dateQuery.timestamp = {};
      if (start) dateQuery.timestamp.$gte = new Date(start);
      if (end) {
        const endOfDay = new Date(end);
        endOfDay.setUTCHours(23, 59, 59, 999);
        dateQuery.timestamp.$lte = endOfDay;
      }
    }

    const [totalSent, totalDelivered, totalRead] = await Promise.all([
      ConversationMessage.countDocuments({ ...dateQuery, direction: 'outbound', status: { $ne: 'failed' } }),
      ConversationMessage.countDocuments({ ...dateQuery, direction: 'outbound', status: { $in: ['delivered', 'read'] } }),
      ConversationMessage.countDocuments({ ...dateQuery, direction: 'outbound', status: 'read' }),
    ]);

    res.json({
      spent: 0,
      currency: 'ARS',
      costPerMessage: 0,
      sent: totalSent,
      delivered: totalDelivered,
      read: totalRead,
      uniqueResponses: 0,
      period: { start: start || 'N/A', end: end || 'N/A' },
    });
  } catch (error: any) {
    console.error('[Dashboard] Error in getMetaWhatsAppStats:', error);
    res.json({
      spent: 0, currency: 'ARS', costPerMessage: 0,
      sent: 0, delivered: 0, read: 0, uniqueResponses: 0,
      error: 'Error al obtener datos',
    });
  }
};

/**
 * Obtiene estadísticas de mensajería por plataforma
 * GET /api/dashboard/messaging-stats?platform=whatsapp|instagram&startDate=...&endDate=...
 */
export const getMessagingStats = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, platform } = req.query;
    const start = (startDate as string) || '';
    const end = (endDate as string) || '';

    const dateQuery: any = {};
    if (start || end) {
      dateQuery.timestamp = {};
      if (start) dateQuery.timestamp.$gte = new Date(start);
      if (end) {
        const endOfDay = new Date(end);
        endOfDay.setUTCHours(23, 59, 59, 999);
        dateQuery.timestamp.$lte = endOfDay;
      }
    }

    // Filtro opcional por plataforma
    if (platform === 'whatsapp' || platform === 'instagram') {
      dateQuery.platform = platform;
    }

    const [totalSent, totalDelivered, totalRead] = await Promise.all([
      ConversationMessage.countDocuments({
        ...dateQuery,
        direction: 'outbound',
        status: { $ne: 'failed' },
      }),
      ConversationMessage.countDocuments({
        ...dateQuery,
        direction: 'outbound',
        status: { $in: ['delivered', 'read'] },
      }),
      ConversationMessage.countDocuments({
        ...dateQuery,
        direction: 'outbound',
        status: 'read',
      }),
    ]);

    res.json({
      spent: 0,
      currency: 'ARS',
      costPerMessage: 0,
      sent: totalSent,
      delivered: totalDelivered,
      read: totalRead,
      uniqueResponses: 0,
      platform: platform || 'all',
      period: { start: start || 'N/A', end: end || 'N/A' },
    });
  } catch (error: any) {
    console.error('[Dashboard] Error en getMessagingStats:', error);
    res.status(500).json({
      spent: 0, currency: 'ARS', costPerMessage: 0,
      sent: 0, delivered: 0, read: 0, uniqueResponses: 0,
      error: 'Error al obtener datos',
    });
  }
};

export const getUnreadMessagesCount = async (req: Request, res: Response) => {
  try {
    const count = await ConversationMessage.countDocuments({ 
      direction: 'inbound', 
      isAdminRead: false 
    });
    res.json({ unreadCount: count });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
