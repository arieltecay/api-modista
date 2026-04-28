import { Request, Response } from 'express';
import { logError } from '../../services/logger.js';
import { testimonialService } from '../../services/testimonials/testimonial-service.js';

/**
 * Obtiene los testimonios activos para el frontend
 */
export const getTestimonials = async (req: Request, res: Response): Promise<void> => {
  try {
    const testimonials = await testimonialService.getActiveTestimonials();
    res.status(200).json(testimonials);
  } catch (error) {
    logError("getTestimonials", error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: "Error al obtener los testimonios" });
  }
};

/**
 * Obtiene todos los testimonios para el admin
 */
export const getAllTestimonials = async (req: Request, res: Response): Promise<void> => {
  try {
    const testimonials = await testimonialService.getAllTestimonials();
    res.status(200).json(testimonials);
  } catch (error) {
    logError("getAllTestimonials", error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: "Error al obtener todos los testimonios" });
  }
};

/**
 * Crea un nuevo testimonio
 */
export const createTestimonial = async (req: Request, res: Response): Promise<void> => {
  try {
    const testimonial = await testimonialService.createTestimonial(req.body);
    res.status(201).json(testimonial);
  } catch (error) {
    logError("createTestimonial", error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: "Error al crear el testimonio" });
  }
};

/**
 * Actualiza un testimonio
 */
export const updateTestimonial = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const testimonial = await testimonialService.updateTestimonial(id as string, req.body);
    if (!testimonial) {
      res.status(404).json({ message: "Testimonio no encontrado" });
      return;
    }
    res.status(200).json(testimonial);
  } catch (error) {
    logError("updateTestimonial", error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: "Error al actualizar el testimonio" });
  }
};

/**
 * Elimina un testimonio
 */
export const deleteTestimonial = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const testimonial = await testimonialService.deleteTestimonial(id as string);
    if (!testimonial) {
      res.status(404).json({ message: "Testimonio no encontrado" });
      return;
    }
    res.status(200).json({ message: "Testimonio eliminado correctamente" });
  } catch (error) {
    logError("deleteTestimonial", error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: "Error al eliminar el testimonio" });
  }
};
