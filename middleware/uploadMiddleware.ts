import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../config/cloudinaryConfig.js';
import { Request } from 'express';

/**
 * Configuración del almacenamiento de Multer para subir archivos a Cloudinary.
 * Permite especificar la carpeta, formatos permitidos y el public_id.
 * Soporta transformaciones como la eliminación de fondo si se especifica en el cuerpo de la petición.
 * Nota: El campo 'removeBackground' debe enviarse ANTES del archivo en el FormData para que esté disponible en req.body.
 */
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req: Request, file: Express.Multer.File) => {
    const publicIdBase = file.originalname.split('.')[0] + '-' + Date.now();
    const transformations: any[] = [];

    // Verificar si se debe eliminar el fondo (viene del frontend)
    if (req.body && req.body.removeBackground === 'true') {
      transformations.push({ effect: 'background_removal' });
    }

    // Siempre intentamos optimizar la imagen
    transformations.push({ fetch_format: 'auto', quality: 'auto' });

    return {
      folder: 'modista_app',
      allowed_formats: ['jpg', 'png', 'jpeg', 'gif', 'webp'],
      public_id: publicIdBase,
      transformation: transformations,
    };
  },
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // Limite de 5MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Formato de archivo no permitido. Solo se aceptan imágenes (JPG, PNG, WebP, GIF).'));
    }
  }
});

export default upload;
