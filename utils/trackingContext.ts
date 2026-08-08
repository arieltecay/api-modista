import type { Request } from 'express';
import { getCookieFromRequest } from './requestUtils.js';
import { getGeoLocationFromRequest } from '../services/geolocation/index.js';
import type { TrackingHttpContext } from '../services/courses/courseTrackingService.js';

const getHeader = (req: Request, name: string): string | undefined => {
    const value = req.headers[name.toLowerCase()];
    if (!value) return undefined;
    return Array.isArray(value) ? value[0] : value;
};

export const buildTrackingContextFromRequest = (req: Request, fallbackUrl: string): TrackingHttpContext => {
    const clientIpAddress = (req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress || '').toString();
    const clientUserAgent = req.headers['user-agent'] || '';
    const referer = req.headers.referer ?? req.headers.referrer;
    const refererStr = Array.isArray(referer) ? referer[0] : referer;
    const eventSourceUrl = refererStr && refererStr.trim().length > 0 ? refererStr : fallbackUrl;

    const geo = getGeoLocationFromRequest(req);

    // Prioridad: headers custom (frontend cross-origin) > cookies (mismo dominio)
    const fbc = getHeader(req, 'x-meta-fbc') || getCookieFromRequest(req, '_fbc');
    const fbp = getHeader(req, 'x-meta-fbp') || getCookieFromRequest(req, '_fbp');

    return {
        clientIpAddress,
        clientUserAgent,
        eventSourceUrl,
        fbc,
        fbp,
        city: geo.city,
        country: geo.country,
    };
};
