export interface ValidationResult {
  valid: boolean;
  error?: { status: number; message: string };
  resolvedCourse?: any;
  turnoData?: any;
  finalCourseId?: string;
}

export interface InscriptionBody {
  nombre: string;
  apellido: string;
  email: string;
  celular: string;
  courseId: string;
  courseTitle: string;
  coursePrice: number;
  turnoId?: string;
}

export interface CreateInscriptionResult {
  success: boolean;
  data: any;
  mpPaymentLink: string | null;
}
