import { Router } from 'express';
import upload from '../../middleware/uploadMiddleware.js';
import { uploadImage, deleteImage } from '../../controllers/upload/uploadController.js';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';

const router = Router();

/**
 * @route POST /api/upload
 * @desc Sube una imagen a Cloudinary.
 * @access Private/Admin
 * @params image - El archivo de imagen.
 * @params removeBackground - 'true' o 'false' para eliminación de fondo con IA.
 */
router.post('/', authenticateToken, requireAdmin, upload.single('image'), uploadImage);

/**
 * @route DELETE /api/upload
 * @desc Borra una imagen de Cloudinary usando su publicId.
 * @access Private/Admin
 * @query publicId - El ID público de la imagen en Cloudinary.
 */
router.delete('/', authenticateToken, requireAdmin, deleteImage);

export default router;
