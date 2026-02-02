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
  turnoId?: string;
}

export interface GetInscriptionsQuery {
  page?: string;
  limit?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
  paymentStatusFilter?: string;
  courseFilter?: string;
  excludeWorkshops?: string; // 'true' | 'false'
}

export interface UpdateDepositBody {
  depositAmount: number;
}

export interface UpdatePaymentStatusBody {
  paymentStatus: 'pending' | 'paid';
}

export interface ExportInscriptionsQuery {
  paymentStatusFilter?: 'all' | 'paid' | 'pending';
  search?: string;
  courseFilter?: string;
  excludeWorkshops?: string; // 'true' | 'false'
}