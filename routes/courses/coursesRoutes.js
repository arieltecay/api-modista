import express from 'express';

import { getCourses } from '../../controllers/courses/coursesController.js';
const router = express.Router();

router.get('/', getCourses);

export default router;
