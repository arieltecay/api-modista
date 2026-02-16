import express, { Router } from 'express';
import { getTariffs, getAvailableTariffMetadata } from '../../controllers/tariff/tariffController.js'; // Importar la nueva función

const router: Router = express.Router();

router.get('/', getTariffs);

router.get('/meta', getAvailableTariffMetadata);

export default router;