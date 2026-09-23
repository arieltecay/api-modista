import type { ICourse } from '../../models/Course.js';

interface ValidationFailure {
  valid: false;
  error: { status: number; message: string };
}

interface ValidationSuccess {
  valid: true;
  resolvedCourse: ICourse;
  turnoData: unknown;
  finalCourseId: string;
  /** Valores tomados de la DB (nunca del body del cliente) — anti price-tampering */
  trustedCourseTitle: string;
  trustedCoursePrice: number;
  normalizedEmail: string;
}

/**
 * Discriminated union: si `valid` es true, TS garantiza la presencia de los
 * datos resueltos; si es false, garantiza `error`. Sin casts `as` en el service.
 */
export type ValidationResult = ValidationSuccess | ValidationFailure;

export interface InscriptionBody {
  nombre: string;
  apellido: string;
  email: string;
  celular: string;
  courseId: string;
  courseTitle: string;
  coursePrice: number;
  turnoId?: string;
  sourceType?: 'app' | 'landing';
  landingPageId?: string;
  marketingSource?: string;
  utmParams?: Record<string, unknown>;
  sessionId?: string;
  metaFbc?: string;
  metaFbp?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  eventSourceUrl?: string;
}

export interface CreateInscriptionResult {
  success: boolean;
  data: unknown;
  mpPaymentLink: string | null;
  mpInitPoint?: string | null;
  sandboxInitPoint?: string | null;
  mpPreferenceId?: string | null;
}
