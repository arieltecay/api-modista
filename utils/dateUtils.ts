import Course from '../models/Course.js';

/**
 * Obtiene la fecha de inicio efectiva para el filtrado de pagos.
 * Prioridad: 
 * 1. Fecha de cierre más reciente del curso.
 * 2. Primer día del mes actual.
 */
export const getEffectiveStartDate = async (courseId: string): Promise<Date> => {
  // 1. Buscar el curso para encontrar el ID de Mongoose (si es necesario) y el UUID
  const course = await Course.findOne({ uuid: courseId });
  
  if (course && course.lastMonthlyClosureDate) {
    // Si existe una fecha de último cierre, el ciclo empieza al día siguiente
    const nextDay = new Date(course.lastMonthlyClosureDate);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(0, 0, 0, 0);
    return nextDay;
  }

  // 2. Por defecto, primer día del mes actual
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
};
