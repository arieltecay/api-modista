import type { Request } from 'express';
import { getCookieFromRequest } from './requestUtils.js';
import { getGeoLocationFromRequest } from '../services/geolocation/index.js';
import type { TrackingHttpContext } from '../services/courses/courseTrackingService.js';
import { getClientIpAddress } from './clientIpAddress.js';
import { isMetaMarketingConsentGranted } from './metaMarketingConsent.js';
import { hasCurrentMetaMarketingConsent } from '../services/privacy/marketingConsent.js';

const getHeader = (req: Request, name: string): string | undefined => {
    const value = req.headers[name.toLowerCase()];
    if (!value) return undefined;
    return Array.isArray(value) ? value[0] : value;
};

export const buildTrackingContextFromRequest = async (req: Request, fallbackUrl: string): Promise<TrackingHttpContext> => {
    const clientIpAddress = getClientIpAddress(req);
    const clientUserAgent = req.headers['user-agent'] || '';
    const referer = req.headers.referer ?? req.headers.referrer;
    const refererStr = Array.isArray(referer) ? referer[0] : referer;
    const eventSourceUrl = refererStr && refererStr.trim().length > 0 ? refererStr : fallbackUrl;

    const geo = getGeoLocationFromRequest(req);

    // Prioridad: headers custom (frontend cross-origin) > cookies (mismo dominio)
    const consentHeader = getHeader(req, 'x-meta-consent');
    const consentVersion = getHeader(req, 'x-meta-consent-version');
    const consentSessionId = getHeader(req, 'x-session-id');
    const marketingConsent = isMetaMarketingConsentGranted(
        consentHeader,
        consentVersion,
    ) && await hasCurrentMetaMarketingConsent(consentSessionId, consentVersion);
    const fbc = marketingConsent
        ? getHeader(req, 'x-meta-fbc') || getCookieFromRequest(req, '_fbc')
        : undefined;
    const fbp = marketingConsent
        ? getHeader(req, 'x-meta-fbp') || getCookieFromRequest(req, '_fbp')
        : undefined;

    // El identificador solo forma parte del contexto de eventos con consentimiento vigente.
    const sessionId = marketingConsent ? consentSessionId : undefined;

    return {
        clientIpAddress,
        clientUserAgent,
        eventSourceUrl,
        fbc,
        fbp,
        city: geo.city,
        country: geo.country,
        sessionId,
        marketingConsent,
    };
};
