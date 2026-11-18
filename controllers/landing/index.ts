import type { Request, Response } from 'express';
import { getLandingFull as getLandingFullData } from '../../services/landing/index.js';

/**
 * @route GET /api/landings/slug/:slug/full
 * Landing + curso + testimonios en UNA llamada, sin efectos secundarios.
 * El ViewContent se registra por el endpoint de embudo con consentimiento.
 */
export const getLandingFull = async (req: Request<{ slug: string }>, res: Response): Promise<void> => {
  const result = await getLandingFullData(req.params.slug);

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
