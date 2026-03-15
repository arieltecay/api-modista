import { randomUUID } from 'crypto';
import { isValidObjectId } from 'mongoose';
import Course, { ICourse } from '../../models/Course.js';

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

/**
 * Resuelve un identificador (UUID, ObjectId o Posición Legacy) a un documento de Curso.
 * Prioridad: UUID > ObjectId > Posición Legacy.
 * Filtra cursos de test en producción.
 */
export const resolveCourseIdentifier = async (identifier: string): Promise<ICourse | null> => {
  // 1. Determinar entorno y filtro base
  const isDevelopment = process.env.URL_LOCAL === 'http://localhost:5173' || process.env.NODE_ENV === 'development';
  const queryBase = isDevelopment ? {} : { category: { $ne: 'test' } };

  let course: ICourse | null = null;

  // 2. Estrategia A: Buscar por UUID (Prioridad Máxima y Estándar Actual)
  // Los UUIDs v4 tienen 36 caracteres y contienen guiones.
  if (identifier.length === 36 && identifier.includes('-')) {
    course = await Course.findOne({ uuid: identifier, ...queryBase });
    if (course) return course;
  }

  // 3. Estrategia B: Buscar por ObjectId (Compatibilidad Backend/Legacy)
  // Solo intentamos si el string es un ObjectId válido de 24 caracteres hex.
  if (isValidObjectId(identifier)) {
    course = await Course.findOne({ _id: identifier, ...queryBase });
    if (course) return course;
  }

  // 4. Estrategia C: Buscar por Posición Numérica (Legacy - DEPRECATED)
  // Solo si es un número entero positivo.
  const numericId = parseInt(identifier);
  if (!isNaN(numericId) && numericId > 0 && String(numericId) === identifier) {
    // Para resolver por posición, necesitamos todos los cursos ordenados igual que en el listado
    const courses = await Course.find(queryBase).sort({ createdAt: -1, updatedAt: -1 });
    if (numericId <= courses.length) {
      course = courses[numericId - 1]; // Array es 0-indexed
    }
  }

  return course;
};
