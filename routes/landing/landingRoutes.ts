import express from 'express';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';
import {
  createLandingPage,
  getLandingPages,
  getLandingPageBySlug,
  updateLandingPage,
  deleteLandingPage
} from '../../controllers/landing/landingController.js';

const router = express.Router();

/**
 * RUTAS DE LANDING PAGES (Campañas Meta Ads)
 * Base: /api/landings
 */

// Pública: Obtener por slug para el frontend
router.get('/slug/:slug', getLandingPageBySlug);

// Admin: CRUD de campañas
router.post('/', authenticateToken, requireAdmin, createLandingPage);
router.get('/', authenticateToken, requireAdmin, getLandingPages);
router.patch('/:id', authenticateToken, requireAdmin, updateLandingPage);
router.delete('/:id', authenticateToken, requireAdmin, deleteLandingPage);

export default router;
