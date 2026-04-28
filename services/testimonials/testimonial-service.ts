import Testimonial, { ITestimonial } from '../../models/Testimonial.js';

/**
 * Servicio para manejar la lógica de negocio de los testimonios
 */
export const testimonialService = {
  /**
   * Obtiene todos los testimonios activos para el frontend
   */
  async getActiveTestimonials(): Promise<ITestimonial[]> {
    return await Testimonial.find({ isActive: true }).sort({ createdAt: -1 });
  },

  /**
   * Obtiene todos los testimonios para el admin
   */
  async getAllTestimonials(): Promise<ITestimonial[]> {
    return await Testimonial.find().sort({ createdAt: -1 });
  },

  /**
   * Crea un nuevo testimonio
   */
  async createTestimonial(data: Partial<ITestimonial>): Promise<ITestimonial> {
    const testimonial = new Testimonial(data);
    return await testimonial.save();
  },

  /**
   * Actualiza un testimonio existente
   */
  async updateTestimonial(id: string, data: Partial<ITestimonial>): Promise<ITestimonial | null> {
    return await Testimonial.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  },

  /**
   * Elimina un testimonio
   */
  async deleteTestimonial(id: string): Promise<ITestimonial | null> {
    return await Testimonial.findByIdAndDelete(id);
  }
};
