import type { Request, Response, NextFunction } from 'express';

/**
 * Caché de borde (CDN de Vercel) SOLO para GET públicos puros: sin efectos
 * secundarios ni datos por usuario. NO usar en endpoints que disparan eventos
 * de Meta CAPI (GET /api/courses/:id, GET /api/landings/slug/:slug/full).
 * `max-age=0`: el navegador siempre revalida; el CDN sirve desde caché.
 */
export const publicCache =
  (sMaxAgeSeconds = 60, staleWhileRevalidateSeconds = 300) =>
  (_req: Request, res: Response, next: NextFunction): void => {
    res.set(
      'Cache-Control',
      `public, max-age=0, s-maxage=${sMaxAgeSeconds}, stale-while-revalidate=${staleWhileRevalidateSeconds}`
    );
    next();
  };
