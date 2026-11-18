import express from 'express';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';
import {
  createLandingPage,
  getLandingPages,
  getLandingPageById,
  getLandingPageBySlug,
  updateLandingPage,
  deleteLandingPage
} from '../../controllers/landing/landingController.js';
import { getLandingFull } from '../../controllers/landing/index.js';
import { publicCache } from '../../middleware/publicCache.js';

const router = express.Router();

/**
 * RUTAS DE LANDING PAGES (Campañas Meta Ads)
 * Base: /api/landings
 */

// Pública: Obtener por slug para el frontend
router.get('/slug/:slug', getLandingPageBySlug);

// Pública: lectura pura de landing + curso + testimonios, con caché CDN corta.
router.get('/slug/:slug/full', publicCache(60, 300), getLandingFull);

// Admin: CRUD de campañas
router.post('/', authenticateToken, requireAdmin, createLandingPage);
router.get('/', authenticateToken, requireAdmin, getLandingPages);
router.get('/:id', authenticateToken, requireAdmin, getLandingPageById);
router.patch('/:id', authenticateToken, requireAdmin, updateLandingPage);
router.delete('/:id', authenticateToken, requireAdmin, deleteLandingPage);

export default router;
