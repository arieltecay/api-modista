import { Schema, model, Document, PaginateModel } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

// Interface para tipar el documento de inscripción
export interface IInscription extends Document {
  nombre: string;
  apellido: string;
  email: string;
  celular: string;
  courseId: string;
  courseTitle: string;
  coursePrice: number;
  paymentStatus: 'pending' | 'paid';
  paymentDate?: Date;
  fechaInscripcion: Date;
}

// Interface para el modelo con paginación
interface IInscriptionModel extends PaginateModel<IInscription> {}

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
    unique: true,
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
    enum: ['pending', 'paid'],
    default: 'pending',
  },
  paymentDate: {
    type: Date,
  },
  fechaInscripcion: {
    type: Date,
    default: Date.now,
  },
});

// Índices para optimizar consultas
InscriptionSchema.index({ paymentStatus: 1, fechaInscripcion: -1 });
InscriptionSchema.index({ nombre: 1, apellido: 1, email: 1 });

InscriptionSchema.plugin(mongoosePaginate);

const Inscription = model<IInscription, IInscriptionModel>('Inscription', InscriptionSchema);

export default Inscription;
