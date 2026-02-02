import { Schema, model, Document, PaginateModel } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

// Interface para tipar el documento de curso
export interface ICourse extends Document {
  title: string;
  shortDescription: string;
  longDescription: string;
  imageUrl: string;
  category: string;
  deeplink?: string;
  videoUrl?: string;
  price: number;
  coursePaid?: string;
  uuid?: string; // UUID único para reemplazar IDs posicionales (opcional durante migración)
  isPresencial?: boolean;
  status?: 'active' | 'inactive';
  createdAt?: Date;
  updatedAt?: Date;
}

// Interface para el modelo con paginación
interface ICourseModel extends PaginateModel<ICourse> { }

const courseSchema = new Schema<ICourse>({
  title: { type: String, required: true },
  shortDescription: { type: String, required: true },
  longDescription: { type: String, required: true },
  imageUrl: { type: String, required: true },
  category: { type: String, required: true },
  deeplink: { type: String },
  videoUrl: { type: String },
  price: { type: Number, required: true },
  coursePaid: { type: String },
  uuid: {
    type: String,
    required: true,
    unique: true
  },
  isPresencial: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },
}, {
  timestamps: true  // Agrega createdAt y updatedAt automáticamente
});

// Agregar plugin de paginación
courseSchema.plugin(mongoosePaginate);

const Course = model<ICourse, ICourseModel>('Course', courseSchema);

export default Course;
