import { IInscription } from '../../models/Inscription.js'; // Importamos la interfaz

// --- Interfaces para tipado ---

export interface CreateInscriptionBody {
  nombre: string;
  apellido: string;
  email: string;
  celular: string;
  courseId: string;
  courseTitle: string;
  coursePrice: number;
}

export interface GetInscriptionsQuery {
  page?: string;
  limit?: string;
  search?: string;
  sortBy?: keyof IInscription;
  sortOrder?: 'asc' | 'desc';
  paymentStatusFilter?: 'all' | 'paid' | 'pending';
  courseFilter?: string;
}

export interface UpdatePaymentStatusBody {
  paymentStatus: 'pending' | 'paid';
}

export interface ExportInscriptionsQuery {
  paymentStatusFilter?: 'all' | 'paid' | 'pending';
  search?: string;
  courseFilter?: string;
}