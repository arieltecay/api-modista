import { isIP } from 'node:net';
import type { Request } from 'express';

export const normalizeClientIpAddress = (value: string | undefined): string | undefined => {
  const address = value?.split(',')[0].trim().replace(/^::ffff:/i, '');
  return address && isIP(address) ? address : undefined;
};

/**
 * Express resolves the client address using the configured trusted proxy.
 * Do not forward the raw X-Forwarded-For chain to third-party services.
 */
export const getClientIpAddress = (req: Pick<Request, 'ip' | 'socket'>): string | undefined =>
  normalizeClientIpAddress(req.ip) ?? normalizeClientIpAddress(req.socket.remoteAddress);
