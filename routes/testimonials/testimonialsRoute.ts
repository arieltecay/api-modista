import express, { Router } from 'express';
import { getTestimonials } from '../../controllers/testimonials/index.js';

const router: Router = express.Router();

router.get('/', getTestimonials);

export default router;
