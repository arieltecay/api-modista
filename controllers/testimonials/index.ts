import { Request, Response } from 'express';
import { logError } from '../../services/logger.js';
import { testimonials } from './courses_data.js';

export const getTestimonials = async (req: Request, res: Response): Promise<void> => {
  try {
    res.status(200).json(testimonials);
  } catch (error) {
    logError("getTestimonials", error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: "Error al obtener los testimonios" });
  }
};
