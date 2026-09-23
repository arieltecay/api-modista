import Turno from '../../models/Turno.js';
import Inscription from '../../models/Inscription.js';
import { resolveCourseIdentifier } from '../../controllers/courses/helper.js';
import { ValidationResult, InscriptionBody } from './types.js';
import type { ICourse } from '../../models/Course.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validateInscriptionData = async (body: InscriptionBody): Promise<ValidationResult> => {
  const { nombre, apellido, email, celular, courseId, turnoId } = body;

  // courseTitle y coursePrice YA NO son requeridos del body:
  // se toman del curso en DB para evitar price tampering.
  if (!nombre || !apellido || !email || !celular || !courseId) {
    return { valid: false, error: { status: 400, message: 'Todos los campos son obligatorios' } };
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  if (!EMAIL_REGEX.test(normalizedEmail)) {
    return { valid: false, error: { status: 400, message: 'Ingresá un email válido' } };
  }

  if (typeof body.coursePrice === 'number' && (Number.isNaN(body.coursePrice) || body.coursePrice < 0)) {
    return { valid: false, error: { status: 400, message: 'Precio de curso inválido' } };
  }

  const resolvedCourse = (await resolveCourseIdentifier(courseId)) as ICourse | null;
  if (!resolvedCourse) {
    return { valid: false, error: { status: 404, message: 'El curso seleccionado no existe.' } };
  }

  // Fuente de verdad del precio/título: la DB, nunca el body del cliente.
  const trustedCoursePrice = Number(resolvedCourse.price);
  if (Number.isNaN(trustedCoursePrice) || trustedCoursePrice < 0) {
    return { valid: false, error: { status: 400, message: 'El curso no tiene un precio válido configurado' } };
  }
  const trustedCourseTitle = resolvedCourse.title;

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

  const finalCourseId = resolvedCourse.uuid as string;
  const existingInscription = await Inscription.findOne({ email: normalizedEmail, courseId: finalCourseId });
  if (existingInscription) {
    return { valid: false, error: { status: 409, message: 'Ya te encuentras inscripto en este curso con este email.' } };
  }

  return {
    valid: true,
    resolvedCourse,
    turnoData,
    finalCourseId,
    trustedCourseTitle,
    trustedCoursePrice,
    normalizedEmail,
  };
};
