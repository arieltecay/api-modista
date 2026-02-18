import express, { Router } from 'express';
import { getTariffs, getAvailableTariffMetadata, searchTariffItems } from '../../controllers/tariff/tariffController.js'; // Importar la nueva función de búsqueda

const router: Router = express.Router();

router.get('/', getTariffs);
router.get('/meta', getAvailableTariffMetadata);
router.get('/search', searchTariffItems);

export default router;