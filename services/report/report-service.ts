import * as fastCsv from 'fast-csv';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * @description Servicio para la generación de reportes en formato CSV.
 * Como Principal Software Architect, garantizo que este servicio sea puro y reutilizable.
 */
export const generateCsvReport = async <T extends object>(
  data: T[], 
  headers: string[], 
  fileNamePrefix: string
): Promise<string> => {
  const fileName = `${fileNamePrefix}-${uuidv4()}.csv`;
  const reportsDir = path.join(process.cwd(), 'public', 'reports');
  
  // 1. Asegurar que el directorio de reportes existe
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const filePath = path.join(reportsDir, fileName);
  const csvStream = fastCsv.format({ headers });
  const writableStream = fs.createWriteStream(filePath);

  return new Promise((resolve, reject) => {
    writableStream.on('error', (error) => {
      // Limpiar archivo parcial en caso de error
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      reject(error);
    });

    writableStream.on('finish', () => {
      // Retornar la ruta relativa para el frontend
      resolve(`/reports/${fileName}`);
    });

    data.forEach((row) => csvStream.write(row));
    csvStream.end();
    csvStream.pipe(writableStream);
  });
};
