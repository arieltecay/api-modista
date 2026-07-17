import { Request, Response } from 'express';
import { Types } from 'mongoose';
import Inscription from '../../models/Inscription.js';
import { logger } from '../../services/logger.js';

/**
 * GET /api/payment/status/:inscriptionId
 *
 * Endpoint PÚBLICO (sin auth) para que el front haga polling del estado
 * del pago después del redirect de MP.
 *
 * Devuelve un resumen seguro (no expone datos sensibles del cliente).
 */
export const getPaymentStatus = async (req: Request<{ inscriptionId: string }>, res: Response): Promise<void> => {
  const { inscriptionId } = req.params;

  if (!Types.ObjectId.isValid(inscriptionId)) {
    res.status(400).json({ error: 'ID inválido' });
    return;
  }

  try {
    const inscription = await Inscription.findById(inscriptionId).select(
      'paymentStatus paymentDate paymentHistory courseTitle coursePrice paymentSource'
    );

    if (!inscription) {
      res.status(404).json({ error: 'Inscripción no encontrada' });
      return;
    }

    const totalPaid = (inscription.paymentHistory || []).reduce(
      (sum, p) => sum + (p.amount || 0),
      0
    );

    res.json({
      paymentStatus: inscription.paymentStatus,
      paymentDate: inscription.paymentDate,
      courseTitle: inscription.courseTitle,
      coursePrice: inscription.coursePrice,
      totalPaid,
      paymentSource: inscription.paymentSource || null,
    });
  } catch (error) {
    logger.error('[getPaymentStatus] Error', error);
    res.status(500).json({ error: 'Error al consultar el estado del pago' });
  }
};
