import { Request, Response } from 'express';
import FunnelEvent from '../../models/FunnelEvent.js';
import { logError } from '../../services/logger.js';
import { getGeoLocationFromRequest } from '../../services/geolocation/index.js';
import { getClientIpAddress } from '../../utils/clientIpAddress.js';
import { hasCurrentMetaMarketingConsent } from '../../services/privacy/marketingConsent.js';
import { isMetaMarketingConsentGranted } from '../../utils/metaMarketingConsent.js';
import { FUNNEL_STEPS, recordFunnelEvent, type FunnelStep } from '../../services/funnel/index.js';

const asOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined;

const isFunnelStep = (value: unknown): value is FunnelStep =>
  typeof value === 'string' && (FUNNEL_STEPS as readonly string[]).includes(value);

/**
 * POST /api/funnel/event
 * Endpoint público llamado por el frontend (modista-app/src/utils/funnel-tracker.ts)
 * Registra cada paso del embudo para diagnóstico interno.
 */
export const trackFunnelEvent = async (req: Request, res: Response) => {
  const {
    sessionId,
    step,
    courseId,
    courseTitle,
    inscriptionId,
    value,
    eventTime,
    eventId,
    eventSourceUrl: requestedEventSourceUrl,
    utmSource,
    utmCampaign,
    utmMedium,
    referrer,
    fbc,
    fbp,
    device,
  } = req.body ?? {};

  if (typeof sessionId !== 'string' || !isFunnelStep(step)) {
    res.status(400).json({ success: false, message: 'sessionId y step válido son requeridos' });
    return;
  }

  const consentHeader = req.headers['x-meta-consent'];
  const consentVersionHeader = req.headers['x-meta-consent-version'];
  const consentVersion = Array.isArray(consentVersionHeader) ? consentVersionHeader[0] : consentVersionHeader;
  const hasMarketingConsent = isMetaMarketingConsentGranted(consentHeader, consentVersionHeader)
    && await hasCurrentMetaMarketingConsent(sessionId, consentVersion);
  if (!hasMarketingConsent) {
    res.status(204).end();
    return;
  }

  const clientIpAddress = getClientIpAddress(req);
  const clientUserAgent = req.headers['user-agent'] || '';
  const referer = asOptionalString(req.headers.referer) || asOptionalString(req.headers.referrer);
  const eventSourceUrl = asOptionalString(requestedEventSourceUrl)
    || asOptionalString(req.body.referrer)
    || referer
    || 'https://modista-app.com';
  const geo = getGeoLocationFromRequest(req);

  try {
    await recordFunnelEvent({
      sessionId,
      step,
      courseId: asOptionalString(courseId),
      courseTitle: asOptionalString(courseTitle),
      inscriptionId: asOptionalString(inscriptionId),
      value: typeof value === 'number' && Number.isFinite(value) ? value : undefined,
      eventId: asOptionalString(eventId),
      eventTime: typeof eventTime === 'number' && Number.isFinite(eventTime) ? eventTime : undefined,
      eventSourceUrl,
      utmSource: asOptionalString(utmSource),
      utmCampaign: asOptionalString(utmCampaign),
      utmMedium: asOptionalString(utmMedium),
      referrer: asOptionalString(referrer),
      device: device === 'mobile' || device === 'desktop' ? device : undefined,
      fbc: asOptionalString(fbc),
      fbp: asOptionalString(fbp),
      clientIpAddress,
      clientUserAgent,
      city: geo.city,
      country: geo.country,
      marketingConsent: hasMarketingConsent,
    });

    res.status(200).json({ success: true });
  } catch (err) {
    logError('trackFunnelEvent', err instanceof Error ? err : new Error(String(err)));
    res.status(500).json({ success: false });
  }
};

/**
 * Orden canónico del embudo para el dashboard.
 * Si un step no tiene datos en el período, no aparece en la respuesta.
 * El frontend espera { funnel: [{ step, uniqueSessions, conversionFromPrev }] }.
 */
const FUNNEL_STEP_ORDER = [
  'course_detail_view',
  'pricing_visible',
  'cta_click',
  'form_view',
  'form_start',
  'form_submit',
  'lead',
  'initiate_checkout',
  'redirect_to_payment',
  'purchase',
] as const;

/**
 * GET /api/funnel/stats?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * Protegido con authenticateToken + requireAdmin.
 * Devuelve el embudo de conversión por sesiones únicas en el período.
 */
export const getFunnelStats = async (req: Request, res: Response) => {
  const { startDate, endDate } = req.query;

  const start = startDate ? new Date(String(startDate)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = endDate ? new Date(String(endDate)) : new Date();

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    res.status(400).json({ success: false, message: 'startDate y endDate deben ser fechas válidas' });
    return;
  }

  try {
    const aggregation = await FunnelEvent.aggregate([
      {
        $match: {
          timestamp: { $gte: start, $lte: end },
          step: { $in: [...FUNNEL_STEP_ORDER] },
        },
      },
      {
        $group: {
          _id: { step: '$step', sessionId: '$sessionId' },
        },
      },
      {
        $group: {
          _id: '$_id.step',
          uniqueSessions: { $sum: 1 },
        },
      },
    ]);

    const countByStep = new Map<string, number>(
      aggregation.map((row: { _id: string; uniqueSessions: number }) => [row._id, row.uniqueSessions])
    );

    const funnel = FUNNEL_STEP_ORDER
      .map((step) => {
        const uniqueSessions = countByStep.get(step) ?? 0;
        return { step, uniqueSessions };
      })
      .filter((row) => row.uniqueSessions > 0);

    let prevCount: number | null = null;
    const funnelWithConversion = funnel.map((row) => {
      const conversionFromPrev = prevCount && prevCount > 0 ? (row.uniqueSessions / prevCount) * 100 : null;
      prevCount = row.uniqueSessions;
      return { ...row, conversionFromPrev };
    });

    res.json({ funnel: funnelWithConversion });
  } catch (err) {
    logError('getFunnelStats', err instanceof Error ? err : new Error(String(err)));
    res.status(500).json({ success: false });
  }
};
