import { Request, Response } from 'express';
import { runInscriptionsRecovery } from '../../services/inscriptions/recoveryService.js';
import { logError } from '../../services/logger.js';

/**
 * Trigger manual o por cron para el motor de recuperación
 */
export const triggerInscriptionsRecovery = async (req: Request, res: Response) => {
  try {
    // Aquí podrías añadir un chequeo de API KEY si lo llamas desde un cron externo (ej. Vercel Cron)
    const result = await runInscriptionsRecovery();
    
    res.status(200).json({
      success: true,
      message: 'Motor de recuperación ejecutado con éxito',
      data: result
    });
  } catch (error) {
    logError('triggerInscriptionsRecovery', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({
      success: false,
      message: 'Error al ejecutar el motor de recuperación'
    });
  }
};
