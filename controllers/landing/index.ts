import type { Request, Response } from 'express';
import { buildTrackingContextFromRequest } from '../../utils/trackingContext.js';
import { getLandingFull as getLandingFullData } from '../../services/landing/index.js';

/**
 * @route GET /api/landings/slug/:slug/full
 * Landing + curso + testimonios en UNA llamada. Dispara el ViewContent de Meta
 * CAPI (igual que GET /api/courses/:id) → la respuesta NO debe cachearse en CDN.
 */
export const getLandingFull = async (req: Request<{ slug: string }>, res: Response): Promise<void> => {
  const ctx = buildTrackingContextFromRequest(req, 'https://modista-app.com');
  const result = await getLandingFullData(req.params.slug, ctx);

  res.set('Cache-Control', 'no-store');

  if (result.status === 'landing_not_found') {
    res.status(404).json({ success: false, message: 'Landing Page no encontrada o inactiva' });
    return;
  }
  if (result.status === 'course_not_found') {
    res.status(404).json({ success: false, message: 'Curso no encontrado' });
    return;
  }

  res.status(200).json({
    success: true,
    data: { landing: result.landing, course: result.course, testimonials: result.testimonials },
  });
};
