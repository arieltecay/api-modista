import { randomUUID } from 'crypto';
import { isValidObjectId, Document } from 'mongoose';
import Course, { ICourse } from '../../models/Course.js';

// Tipo para documentos planos retornados por .lean() en Mongoose 8
type CourseLean = Omit<ICourse, keyof Document> & { _id: any };

// Función helper para generar UUID único verificando unicidad en BD
export const generateUniqueUUID = async (): Promise<string> => {
  let uuid: string;
  let attempts = 0;
  const maxAttempts = 10;

  do {
    uuid = randomUUID();
    attempts++;

    const existingCourse = await Course.findOne({ uuid }).select('_id').lean();

    if (!existingCourse) {
      return uuid;
    }
  } while (attempts < maxAttempts);

  throw new Error('No se pudo generar un UUID único después de varios intentos');
};

/**
 * Resuelve un identificador (UUID, ObjectId o Posición Legacy) a un documento de Curso.
 * Prioridad: UUID > ObjectId > Posición Legacy.
 * Solo devuelve cursos activos.
 */
export const resolveCourseIdentifier = async (identifier: string): Promise<CourseLean | null> => {
  const queryBase = { status: 'active' };

  let course: CourseLean | null = null;

  // Estrategia A: Buscar por UUID (Prioridad Máxima)
  if (identifier.length === 36 && identifier.includes('-')) {
    course = await Course.findOne({ uuid: identifier, ...queryBase }).lean();
    if (course) return course;
  }

  // Estrategia B: Buscar por ObjectId
  if (isValidObjectId(identifier)) {
    course = await Course.findOne({ _id: identifier, ...queryBase }).lean();
    if (course) return course;
  }

  // Estrategia C: Posición Numérica (Legacy - DEPRECATED)
  const numericId = parseInt(identifier);
  if (!isNaN(numericId) && numericId > 0 && String(numericId) === identifier) {
    const courses = await Course.find(queryBase)
      .select('-longDescription')
      .sort({ createdAt: -1 })
      .lean();
    if (numericId <= courses.length) {
      course = courses[numericId - 1];
    }
  }

  return course;
};
