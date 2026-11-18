import type { ErrorRequestHandler, Request, Response } from 'express';
import type { ZodType, z } from 'zod';
import { redactError } from '../../services/Acquisition/errors.js';
import {
  funnelQuerySchema,
  journeyParamsSchema,
  journeysQuerySchema,
  liveQuerySchema,
  qualityQuerySchema,
  reportQuerySchema,
} from '../../services/AcquisitionReports/filters.js';
import {
  getChannelsReport,
  getFunnelReport,
  getJourneyDetail,
  getJourneys,
  getLiveReport,
  getOverviewReport,
  getQualityReport,
} from '../../services/AcquisitionReports/index.js';
import { ReportRangeError } from '../../services/AcquisitionReports/range.js';
import { logError } from '../../services/logger.js';

type InputSource = 'query' | 'params';

/**
 * Validates the input (400, never echoing values), builds the report (null means 404) and sends
 * it. Failures reach `handleReportError`.
 */
const createReportHandler =
  <Schema extends ZodType>(schema: Schema, source: InputSource, build: (input: z.output<Schema>) => Promise<object | null>) =>
  async (req: Request, res: Response): Promise<void> => {
    const parsed = schema.safeParse(source === 'query' ? req.query : req.params);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code }));
      res.status(400).json({ success: false, message: 'Parámetros inválidos', issues });
      return;
    }

    const report = await build(parsed.data);
    if (report === null) {
      res.status(404).json({ success: false, message: 'No encontrado' });
      return;
    }
    res.status(200).json(report);
  };

/** GET /api/admin/acquisition/overview */
export const getOverview = createReportHandler(reportQuerySchema, 'query', (filters) => getOverviewReport(filters));

/** GET /api/admin/acquisition/channels */
export const getChannels = createReportHandler(reportQuerySchema, 'query', (filters) => getChannelsReport(filters));

/** GET /api/admin/acquisition/funnel */
export const getFunnel = createReportHandler(funnelQuerySchema, 'query', (filters) => getFunnelReport(filters));

/** GET /api/admin/acquisition/live */
export const getLive = createReportHandler(liveQuerySchema, 'query', (query) => getLiveReport(query));

/** GET /api/admin/acquisition/journeys */
export const getJourneyList = createReportHandler(journeysQuerySchema, 'query', (filters) => getJourneys(filters));

/** GET /api/admin/acquisition/journeys/:visitId */
export const getJourney = createReportHandler(journeyParamsSchema, 'params', ({ visitId }) => getJourneyDetail(visitId));

/** GET /api/admin/acquisition/quality */
export const getQuality = createReportHandler(qualityQuerySchema, 'query', (filters) => getQualityReport(filters));

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
