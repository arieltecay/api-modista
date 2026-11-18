import type { ErrorRequestHandler, Request, Response } from 'express';
import { redactError } from '../../services/Acquisition/errors.js';
import { reportQuerySchema } from '../../services/AcquisitionReports/filters.js';
import type { ReportQuery } from '../../services/AcquisitionReports/filters.js';
import { getChannelsReport, getOverviewReport } from '../../services/AcquisitionReports/index.js';
import { ReportRangeError } from '../../services/AcquisitionReports/range.js';
import { logError } from '../../services/logger.js';

/** Validates the query (400, never echoing values) and returns the report; failures reach `handleReportError`. */
const createReportHandler =
  <T>(build: (filters: ReportQuery) => Promise<T>) =>
  async (req: Request, res: Response): Promise<void> => {
    const parsed = reportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code }));
      res.status(400).json({ success: false, message: 'Parámetros inválidos', issues });
      return;
    }
    res.status(200).json(await build(parsed.data));
  };

/** GET /api/admin/acquisition/overview */
export const getOverview = createReportHandler((filters) => getOverviewReport(filters));

/** GET /api/admin/acquisition/channels */
export const getChannels = createReportHandler((filters) => getChannelsReport(filters));

const isMongoTimeout = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { codeName?: unknown }).codeName === 'MaxTimeMSExpired';

/** Fixed messages only: driver errors name collections, stages and indexes. */
export const handleReportError: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ReportRangeError) {
    res.status(400).json({ success: false, message: error.message });
    return;
  }
  logError('acquisitionReports', redactError(error));
  if (isMongoTimeout(error)) {
    res.status(504).json({ success: false, message: 'El reporte tardó demasiado: acotá el rango o los filtros' });
    return;
  }
  res.status(500).json({ success: false, message: 'Error interno del servidor' });
};
