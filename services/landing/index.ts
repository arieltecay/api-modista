import type { Document, HydratedDocument } from 'mongoose';
import LandingPage, { ILandingPage } from '../../models/LandingPage.js';
import type { ICourse } from '../../models/Course.js';
import type { ITestimonial } from '../../models/Testimonial.js';
import { resolveCourseIdentifier } from '../../controllers/courses/helper.js';
import { testimonialService } from '../testimonials/testimonial-service.js';
import { cache } from '../../utils/cache.js';

const COURSE_CACHE_TTL_SECONDS = 300;

/** Documento plano de Curso (mismo shape que devuelve resolveCourseIdentifier). */
type CourseLean = Omit<ICourse, keyof Document> & { _id: any };

/** Curso normalizado para el frontend: `id` = uuid, `courseId` = _id. */
type CourseDetail = CourseLean & { id?: string; courseId?: string };

type LandingPageDocument = HydratedDocument<ILandingPage>;

export type LandingFullResult =
  | { status: 'ok'; landing: LandingPageDocument; course: CourseDetail; testimonials: ITestimonial[] }
  | { status: 'landing_not_found' }
  | { status: 'course_not_found' };

/**
 * Landing + curso + testimonios en una sola llamada.
 * Es una lectura pura: el tracking se procesa de forma separada por el
 * endpoint de embudo para no penalizar el camino crítico de la landing.
 */
export const getLandingFull = async (
  slug: string,
): Promise<LandingFullResult> => {
  const landing = await LandingPage.findOne({ slug, status: 'active' });
  if (!landing) return { status: 'landing_not_found' };

  const identifier = landing.courseId;
  const cacheKey = `course_detail_${identifier}`;
  const cachedCourse = cache.get<CourseDetail>(cacheKey);

  let course: CourseDetail;
  if (cachedCourse) {
    course = cachedCourse;
  } else {
    const found = await resolveCourseIdentifier(identifier);
    if (!found) return { status: 'course_not_found' };

    course = { ...found, id: found.uuid, courseId: found._id?.toString() };
    cache.set(cacheKey, course, COURSE_CACHE_TTL_SECONDS);
  }

  // Mismo filtro que hacía el front: course.id (uuid) || _id
  const testimonialsCourseId = course.id || course.courseId;
  const testimonials = await testimonialService
    .getActiveTestimonials(testimonialsCourseId)
    .catch(() => [] as ITestimonial[]);

  return { status: 'ok', landing, course, testimonials };
};
