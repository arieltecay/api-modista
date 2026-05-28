import { Request, Response } from 'express';
import LandingPage from '../../models/LandingPage.js';
import { logError } from '../../services/logger.js';
import { CreateLandingPageBody, GetLandingPagesQuery, UpdateLandingPageBody } from './types.js';

/**
 * @desc    Crear una nueva Landing Page
 * @route   POST /api/landings
 * @access  Private (Admin)
 */
export const createLandingPage = async (req: Request<{}, {}, CreateLandingPageBody>, res: Response) => {
  try {
    const { slug } = req.body;
    
    // Verificar si el slug ya existe
    const existingLanding = await LandingPage.findOne({ slug });
    if (existingLanding) {
      return res.status(400).json({ success: false, message: 'El slug ya está en uso' });
    }

    const landingPage = await LandingPage.create(req.body);
    res.status(201).json({ success: true, data: landingPage });
  } catch (error: any) {
    logError('createLandingPage', error);
    res.status(500).json({ success: false, message: 'Error al crear la Landing Page', error: error.message });
  }
};

/**
 * @desc    Obtener todas las Landing Pages con paginación
 * @route   GET /api/landings
 * @access  Private (Admin)
 */
export const getLandingPages = async (req: Request<{}, {}, {}, GetLandingPagesQuery>, res: Response) => {
  const { page = '1', limit = '10', search } = req.query;

  try {
    let query: any = {};
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { slug: { $regex: search, $options: 'i' } }
      ];
    }

    const options = {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      sort: { createdAt: -1 }
    };

    const result = await (LandingPage as any).paginate(query, options);

    res.status(200).json({ success: true, data: result.docs, total: result.totalDocs, totalPages: result.totalPages, currentPage: result.page });
  } catch (error: any) {
    logError('getLandingPages', error);
    res.status(500).json({ success: false, message: 'Error al obtener las Landing Pages' });
  }
};

/**
 * @desc    Obtener una Landing Page por ID
 * @route   GET /api/landings/:id
 * @access  Private (Admin)
 */
export const getLandingPageById = async (req: Request<{ id: string }>, res: Response) => {
  try {
    const landingPage = await LandingPage.findById(req.params.id);
    
    if (!landingPage) {
      return res.status(404).json({ success: false, message: 'Landing Page no encontrada' });
    }

    res.status(200).json({ success: true, data: landingPage });
  } catch (error: any) {
    logError('getLandingPageById', error);
    res.status(500).json({ success: false, message: 'Error al obtener la Landing Page' });
  }
};


/**
 * @desc    Obtener una Landing Page por su slug (Público)
 * @route   GET /api/landings/slug/:slug
 * @access  Public
 */
export const getLandingPageBySlug = async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const landingPage = await LandingPage.findOne({ slug: req.params.slug, status: 'active' });
    
    if (!landingPage) {
      return res.status(404).json({ success: false, message: 'Landing Page no encontrada o inactiva' });
    }

    res.status(200).json({ success: true, data: landingPage });
  } catch (error: any) {
    logError('getLandingPageBySlug', error);
    res.status(500).json({ success: false, message: 'Error al obtener la Landing Page' });
  }
};

/**
 * @desc    Actualizar una Landing Page
 * @route   PATCH /api/landings/:id
 * @access  Private (Admin)
 */
export const updateLandingPage = async (req: Request<{ id: string }, {}, UpdateLandingPageBody>, res: Response) => {
  try {
    const landingPage = await LandingPage.findByIdAndUpdate(req.params.id, req.body, { new: true });
    
    if (!landingPage) {
      return res.status(404).json({ success: false, message: 'Landing Page no encontrada' });
    }

    res.status(200).json({ success: true, data: landingPage });
  } catch (error: any) {
    logError('updateLandingPage', error);
    res.status(500).json({ success: false, message: 'Error al actualizar la Landing Page' });
  }
};

/**
 * @desc    Eliminar una Landing Page
 * @route   DELETE /api/landings/:id
 * @access  Private (Admin)
 */
export const deleteLandingPage = async (req: Request<{ id: string }>, res: Response) => {
  try {
    const landingPage = await LandingPage.findByIdAndDelete(req.params.id);
    
    if (!landingPage) {
      return res.status(404).json({ success: false, message: 'Landing Page no encontrada' });
    }

    res.status(200).json({ success: true, message: 'Landing Page eliminada correctamente' });
  } catch (error: any) {
    logError('deleteLandingPage', error);
    res.status(500).json({ success: false, message: 'Error al eliminar la Landing Page' });
  }
};
