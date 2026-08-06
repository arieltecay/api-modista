import geoip from 'geoip-lite';
import type { Request } from 'express';
import { logger } from '../logger.js';
import type { GeoLocationCacheEntry, GeoLocationResult } from './types.js';

const CACHE_TTL_MS = Number(process.env.GEOLOCATION_CACHE_TTL_MS ?? 24 * 60 * 60 * 1000);
const MAX_CACHE_ENTRIES = 5000;

const cache = new Map<string, GeoLocationCacheEntry>();

const normalizeIp = (raw: string): string | undefined => {
  const ip = raw
    .split(',')[0]
    .trim()
    .replace(/:\d+$/, '')
    .replace(/^::ffff:/i, '');

  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
    return undefined;
  }

  return ip;
};

const cleanCity = (value: string | undefined): string | undefined => {
  const city = value?.trim().toLowerCase();
  return city || undefined;
};

const cleanCountry = (value: string | undefined): string | undefined => {
  const country = value?.trim().toUpperCase();
  return country || undefined;
};

const getVercelGeoFromRequest = (req: Request): GeoLocationResult => {
  const country = cleanCountry(req.headers['x-vercel-ip-country'] as string | undefined);
  const city = cleanCity(req.headers['x-vercel-ip-city'] as string | undefined);
  return { country, city };
};

const getGeoipFromIp = (ip: string): GeoLocationResult => {
  try {
    const lookup = geoip.lookup(ip);
    if (!lookup) return {};

    return {
      city: cleanCity(lookup.city),
      country: cleanCountry(lookup.country),
    };
  } catch (err: unknown) {
    logger.warn('[Geolocation] geoip-lite lookup failed', { ip, err });
    return {};
  }
};

export const getGeoLocationFromIp = (rawIp: string): GeoLocationResult => {
  const ip = normalizeIp(rawIp);
  if (!ip) return {};

  const cached = cache.get(ip);
  if (cached && cached.expiresAt > Date.now()) {
    return { city: cached.city, country: cached.country };
  }

  const result = getGeoipFromIp(ip);

  if (result.city || result.country) {
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) cache.delete(oldestKey);
    }

    cache.set(ip, { ...result, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  return result;
};

export const getGeoLocationFromRequest = (req: Request): GeoLocationResult => {
  const vercel = getVercelGeoFromRequest(req);
  if (vercel.country || vercel.city) {
    return vercel;
  }

  const rawIp = (req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress || '').toString();
  return getGeoLocationFromIp(rawIp);
};

export const clearGeoLocationCache = (): void => {
  cache.clear();
};
