import { Schema, model, Document, PaginateModel, Types } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

export interface IPayment {
  _id?: Types.ObjectId;
  amount: number;
  date: Date;
  paymentMethod?: string;
  notes?: string;
}

// Interface para tipar el documento de inscripción
export interface IInscription extends Document {
  nombre: string;
  apellido: string;
  email: string;
  celular: string;
  courseId: string;
  courseTitle: string;
  coursePrice: number;
  paymentStatus: 'pending' | 'paid' | 'partial';
  paymentDate?: Date;
  turnoId?: Types.ObjectId;
  depositAmount?: number;
  depositDate?: Date;
  isReserved?: boolean;
  fechaInscripcion: Date;
  paymentHistory: IPayment[];
  totalPaid: number;
}

// Interface para el modelo con paginación
interface IInscriptionModel extends PaginateModel<IInscription> { }

// Subdocumento para el historial de pagos (aditivo)
const PaymentSchema = new Schema<IPayment>({
  amount: { type: Number, required: true },
  date: { type: Date, default: Date.now },
  paymentMethod: { type: String, trim: true },
  notes: { type: String, trim: true },
});


const InscriptionSchema = new Schema<IInscription>({
  nombre: {
    type: String,
    required: [true, 'El nombre es obligatorio'],
    trim: true,
  },
  apellido: {
    type: String,
    required: [true, 'El apellido es obligatorio'],
    trim: true,
  },
  email: {
    type: String,
    required: [true, 'El email es obligatorio'],
    trim: true,
    unique: false,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Por favor, introduce un email válido',
    ],
  },
  celular: {
    type: String,
    required: [true, 'El número de celular es obligatorio'],
    trim: true,
  },
  courseId: {
    type: String,
    required: [true, 'El ID del curso es obligatorio'],
    trim: true,
  },
  courseTitle: {
    type: String,
    required: [true, 'El título del curso es obligatorio'],
    trim: true,
  },
  coursePrice: {
    type: Number,
    required: [true, 'El precio del curso es obligatorio'],
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'partial'],
    default: 'pending',
  },
  paymentDate: {
    type: Date,
  },
  turnoId: {
    type: Schema.Types.ObjectId,
    ref: 'Turno',
    required: false,
  },
  depositAmount: {
    type: Number,
    default: 0,
  },
  depositDate: {
    type: Date,
  },
  isReserved: {
    type: Boolean,
    default: false,
  },
  fechaInscripcion: {
    type: Date,
    default: Date.now,
  },
  // Nuevo campo de historial de pagos
  paymentHistory: {
    type: [PaymentSchema],
    default: [],
  }
}, {
  // Habilitar campos virtuales para que se incluyan en las respuestas JSON
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual para calcular el total pagado (aditivo)
InscriptionSchema.virtual('totalPaid').get(function() {
  if (this.paymentHistory && this.paymentHistory.length > 0) {
    return this.paymentHistory.reduce((total, payment) => total + payment.amount, 0);
  }
  // Fallback al depositAmount si no hay historial, para datos antiguos
  return this.depositAmount || 0;
});


// Índices para optimizar consultas
InscriptionSchema.index({ paymentStatus: 1, fechaInscripcion: -1 });
InscriptionSchema.index({ nombre: 1, apellido: 1, email: 1 });

InscriptionSchema.index({ email: 1, courseId: 1 }, { unique: true });

InscriptionSchema.plugin(mongoosePaginate);

const Inscription = model<IInscription, IInscriptionModel>('Inscription', InscriptionSchema);

export default Inscription;
