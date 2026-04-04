import type { Request, Response } from 'express';
import { processMonthlyClosureService, getMonthlyReportsService } from '../../services/course/monthly-closure-service.js';
import { logError } from '../../services/logger.js';
import { AppError } from '../../utils/errors.js';

/**
 * @description Orquestador del cierre mensual de un curso.
 */
export const processMonthlyClosure = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const { id: courseId } = req.params;
    const { closureDate } = req.body;

    // 1. Validar parámetros (Básico, se podría delegar a un middleware de validación)
    if (!closureDate) {
      res.status(400).json({ success: false, message: 'La fecha de cierre es requerida' });
      return;
    }

    // 2. Ejecutar lógica de negocio
    const result = await processMonthlyClosureService(courseId, new Date(closureDate));

    // 3. Responder
    res.status(201).json({
      success: true,
      data: result,
      message: 'Cierre mensual procesado exitosamente'
    });
  } catch (error) {
    logError('processMonthlyClosure', error instanceof Error ? error : new Error(String(error)));
    
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, message: error.message });
    } else {
      res.status(500).json({ success: false, message: 'Error interno del servidor al procesar el cierre' });
    }
  }
};

/**
 * @description Recupera el listado de cierres procesados para un curso.
 */
export const getMonthlyReports = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const { id: courseId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const result = await getMonthlyReportsService(courseId, page, limit);

    res.status(200).json({
      success: true,
      data: result.docs,
      total: result.totalDocs,
      totalPages: result.totalPages,
      currentPage: result.page,
    });
  } catch (error) {
    logError('getMonthlyReports', error instanceof Error ? error : new Error(String(error)));
    
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, message: error.message });
    } else {
      res.status(500).json({ success: false, message: 'Error interno del servidor al obtener reportes' });
    }
  }
};
