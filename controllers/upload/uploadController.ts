import { Request, Response } from 'express';
import cloudinary from '../../config/cloudinaryConfig.js';

/**
 * Controlador para manejar la subida de imágenes a Cloudinary.
 * @param req - Objeto de petición Express. Debe incluir el archivo de imagen en req.file.
 * @param res - Objeto de respuesta Express. Devuelve la URL de la imagen subida y el publicId.
 */
export const uploadImage = (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ msg: 'No se proporcionó ningún archivo o hubo un error al subirlo.' });
  }

  // req.file.path contiene la URL de Cloudinary proporcionada por multer-storage-cloudinary
  // req.file.filename contiene el publicId de Cloudinary
  res.json({ 
    imageUrl: req.file.path,
    publicId: req.file.filename
  });
};

/**
 * Controlador para eliminar una imagen de Cloudinary.
 * @param req - Objeto de petición Express. Debe incluir publicId en query params.
 * @param res - Objeto de respuesta Express.
 */
export const deleteImage = async (req: Request, res: Response) => {
  const { publicId } = req.query;

  if (!publicId || typeof publicId !== 'string') {
    return res.status(400).json({ msg: 'No se proporcionó el publicId de la imagen.' });
  }

  try {
    const result = await cloudinary.uploader.destroy(publicId);
    res.json({ success: true, result });
  } catch (error) {
    console.error('Error al borrar imagen de Cloudinary:', error);
    res.status(500).json({ msg: 'Error al borrar la imagen de Cloudinary.' });
  }
};
