import type { Request } from 'express';

export const getCookieFromRequest = (req: Request, name: string): string | undefined => {
  const header = req.headers.cookie;
  if (!header) return undefined;

  const target = `; ${name}=`;
  const parts = `; ${header}`.split(target);
  if (parts.length !== 2) return undefined;

  const tail = parts[1];
  if (!tail) return undefined;
  const value = tail.split(';')[0];
  return value || undefined;
};
