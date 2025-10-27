import { randomUUID } from 'crypto';
import Course from '../../models/Course.js';

// Función helper para generar UUID único verificando unicidad en BD
export const generateUniqueUUID = async (): Promise<string> => {
  let uuid: string;
  let attempts = 0;
  const maxAttempts = 10; // Límite de intentos para evitar bucles infinitos

  do {
    uuid = randomUUID();
    attempts++;

    // Verificar si el UUID ya existe en la BD
    const existingCourse = await Course.findOne({ uuid });

    if (!existingCourse) {
      return uuid; // UUID único encontrado
    }
  } while (attempts < maxAttempts);

  // Si después de varios intentos no encontramos un UUID único, lanzamos error
  throw new Error('No se pudo generar un UUID único después de varios intentos');
};
