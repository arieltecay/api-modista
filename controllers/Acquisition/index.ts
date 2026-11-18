import type { ErrorRequestHandler, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { isAcquisitionTrackingEnabled } from '../../services/Acquisition/config.js';
import { getConsentedVisitorId, purgeIfConsentRevoked } from '../../services/Acquisition/consent.js';
import { redactError } from '../../services/Acquisition/errors.js';
import { recordEvent, recordVisit } from '../../services/Acquisition/index.js';
import { browserSignalBodySchema, eventBodySchema, visitBodySchema } from '../../services/Acquisition/schemas.js';
import { recordBrowserPixelInvoked } from '../../services/Acquisition/signals.js';
import { logError } from '../../services/logger.js';
import type { IngestionOutcome } from './types.js';

const STATUS_BY_OUTCOME: Record<IngestionOutcome, number> = { created: 201, updated: 200, conflict: 409 };

/**
 * Shared pipeline of the public telemetry endpoints, in this order: feature flag (204),
 * consent (204), contract (400), body/session match (400), idempotent write (201/200/409).
 * Never echoes request values back.
 */
const createIngestionHandler =
  <T extends { visitorId: string }>(schema: ZodType<T>, write: (body: T) => Promise<IngestionOutcome>) =>
  async (req: Request, res: Response): Promise<void> => {
    if (!isAcquisitionTrackingEnabled()) {
      res.status(204).end();
      return;
    }

    const consentedVisitorId = await getConsentedVisitorId(req.headers);
    if (!consentedVisitorId) {
      res.status(204).end();
      return;
    }

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code }));
      res.status(400).json({ success: false, message: 'Contrato inválido', issues });
      return;
    }
    if (parsed.data.visitorId !== consentedVisitorId) {
      res.status(400).json({ success: false, message: 'El visitorId no coincide con la sesión consentida' });
      return;
    }

    const outcome = await write(parsed.data);
    if (outcome === 'conflict') {
      res.status(409).json({ success: false, message: 'Identificador ya asociado a otra visita' });
      return;
    }
    // A revocation may have landed mid-request; if so the late record was just purged.
    if (await purgeIfConsentRevoked(req.headers, consentedVisitorId)) {
      res.status(204).end();
      return;
    }
    res.status(STATUS_BY_OUTCOME[outcome]).json({ success: true });
  };

/** POST /api/acquisition/visits */
export const postVisit = createIngestionHandler(visitBodySchema, recordVisit);

/** POST /api/acquisition/events */
export const postEvent = createIngestionHandler(eventBodySchema, (body) => recordEvent(body));

/** POST /api/acquisition/signals/browser */
export const postBrowserSignal = createIngestionHandler(browserSignalBodySchema, recordBrowserPixelInvoked);

/** The global handler logs `req.body`; here it would hold visitor ids, referrers and paths. */
export const handleAcquisitionError: ErrorRequestHandler = (error, _req, res, _next) => {
  logError('acquisition', redactError(error));
  res.status(500).json({ success: false, message: 'Error interno del servidor' });
};
