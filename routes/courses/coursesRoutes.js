import express from 'express';

import { getCourses, getTestimonials } from '../../controllers/courses/coursesController.js';
const router = express.Router();

router.get('/', getCourses);
router.get('/testimonials', getTestimonials);

export default router;
