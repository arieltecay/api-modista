import express, { Router } from 'express';
import { register, login } from '../../controllers/auth/authController.js';

const router: Router = express.Router();

// Ruta para registrar usuario
router.post('/register', register);

// Ruta para login
router.post('/login', login);

export default router;