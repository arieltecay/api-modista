import Turno from '../../models/Turno.js';
import Inscription from '../../models/Inscription.js';
import { resolveCourseIdentifier } from '../../controllers/courses/helper.js';
import { ValidationResult, InscriptionBody } from './types.js';

export const validateInscriptionData = async (body: InscriptionBody): Promise<ValidationResult> => {
  const { nombre, apellido, email, celular, courseId, courseTitle, coursePrice, turnoId } = body;

  if (!nombre || !apellido || !email || !celular || !courseId || !courseTitle || coursePrice == null) {
    return { valid: false, error: { status: 400, message: 'Todos los campos son obligatorios' } };
  }

  const resolvedCourse = await resolveCourseIdentifier(courseId);
  if (!resolvedCourse) {
    return { valid: false, error: { status: 404, message: 'El curso seleccionado no existe.' } };
  }

  let turnoData = null;
  if (turnoId) {
    turnoData = await Turno.findById(turnoId);
    if (!turnoData) {
      return { valid: false, error: { status: 404, message: 'El turno seleccionado no existe' } };
    }
    if (turnoData.isBlocked || !turnoData.isActive) {
      return { valid: false, error: { status: 400, message: 'El turno seleccionado no está disponible' } };
    }
    if (turnoData.cuposInscriptos >= turnoData.cupoMaximo) {
      return { valid: false, error: { status: 400, message: 'El turno seleccionado ya no tiene cupos disponibles' } };
    }
  }

  const finalCourseId = resolvedCourse.uuid;
  const existingInscription = await Inscription.findOne({ email, courseId: finalCourseId });
  if (existingInscription) {
    return { valid: false, error: { status: 409, message: 'Ya te encuentras inscripto en este curso con este email.' } };
  }

  return { valid: true, resolvedCourse, turnoData, finalCourseId };
};
