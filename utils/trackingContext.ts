import type { Request } from 'express';
import { getCookieFromRequest } from './requestUtils.js';
import { getGeoLocationFromRequest } from '../services/geolocation/index.js';
import type { TrackingHttpContext } from '../services/courses/courseTrackingService.js';

export const buildTrackingContextFromRequest = (req: Request, fallbackUrl: string): TrackingHttpContext => {
  const clientIpAddress = (req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress || '').toString();
  const clientUserAgent = req.headers['user-agent'] || '';
  const referer = req.headers.referer ?? req.headers.referrer;
  const refererStr = Array.isArray(referer) ? referer[0] : referer;
  const eventSourceUrl = refererStr && refererStr.trim().length > 0 ? refererStr : fallbackUrl;

  const geo = getGeoLocationFromRequest(req);

  return {
    clientIpAddress,
    clientUserAgent,
    eventSourceUrl,
    fbc: getCookieFromRequest(req, '_fbc'),
    fbp: getCookieFromRequest(req, '_fbp'),
    city: geo.city,
    country: geo.country,
  };
};
