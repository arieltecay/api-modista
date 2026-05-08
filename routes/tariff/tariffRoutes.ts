import express, { Router } from 'express';
import { 
  getTariffs, 
  getAvailableTariffMetadata, 
  searchTariffItems,
  getTariffById,
  createTariff,
  updateTariff,
  deleteTariff,
  duplicateTariff,
  getAdminTariffMetadata
} from '../../controllers/tariff/tariffController.js';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';

const router: Router = express.Router();

router.get('/', getTariffs);
router.get('/meta', getAvailableTariffMetadata);
router.get('/search', searchTariffItems);

// Rutas protegidas para administración
router.get('/admin/all', authenticateToken, requireAdmin, getAdminTariffMetadata);
router.get('/:id', authenticateToken, requireAdmin, getTariffById);
router.post('/', authenticateToken, requireAdmin, createTariff);
router.put('/:id', authenticateToken, requireAdmin, updateTariff);
router.delete('/:id', authenticateToken, requireAdmin, deleteTariff);
router.post('/:id/duplicate', authenticateToken, requireAdmin, duplicateTariff);

export default router;