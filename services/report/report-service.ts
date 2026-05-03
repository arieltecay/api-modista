import * as fastCsv from 'fast-csv';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import cloudinary from '../../config/cloudinaryConfig.js';

/**
 * @description Servicio para la generación de reportes en formato CSV.
 * Como Principal Software Architect, garantizo que este servicio sea puro y reutilizable.
 * Refactorizado para ser compatible con entornos Serverless (Vercel) usando Cloudinary.
 */
export const generateCsvReport = async <T extends object>(
  data: T[], 
  headers: string[], 
  fileNamePrefix: string
): Promise<string> => {
  const fileName = `${fileNamePrefix}-${uuidv4()}.csv`;
  // Usamos el directorio temporal del sistema (único lugar escribible en Vercel)
  const tempDir = os.tmpdir();
  const filePath = path.join(tempDir, fileName);
  
  const csvStream = fastCsv.format({ headers });
  const writableStream = fs.createWriteStream(filePath);

  return new Promise((resolve, reject) => {
    writableStream.on('error', (error) => {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      reject(error);
    });

    writableStream.on('finish', async () => {
      try {
        // Subir a Cloudinary como recurso 'raw' (especial para CSV, PDF, etc)
        const result = await cloudinary.uploader.upload(filePath, {
          resource_type: 'raw',
          public_id: `reports/${fileName}`,
          access_mode: 'public'
        });

        // Limpiar archivo temporal
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        // Retornar la URL segura de Cloudinary
        resolve(result.secure_url);
      } catch (uploadError) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        reject(uploadError);
      }
    });

    data.forEach((row) => csvStream.write(row));
    csvStream.end();
    csvStream.pipe(writableStream);
  });
};
