import { Schema, model, Document } from 'mongoose';

/**
 * Interface para el documento de Testimonio
 */
export interface ITestimonial extends Document {
  name: string;
  description: string;
  role?: string;
  avatarUrl?: string;
  /** uuid del curso al que aplica. Vacío/null = testimonio genérico (aparece en todas las landings) */
  courseId?: string;
  /** Orden de aparición (menor = primero) */
  order: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const testimonialSchema = new Schema<ITestimonial>({
  name: { 
    type: String, 
    required: [true, 'El nombre es obligatorio'],
    trim: true 
  },
  description: { 
    type: String, 
    required: [true, 'La descripción es obligatoria'],
    trim: true 
  },
  role: { 
    type: String, 
    trim: true,
    default: '' 
  },
  avatarUrl: { 
    type: String, 
    trim: true,
    default: '' 
  },
  courseId: {
    type: String,
    trim: true,
    default: '',
    index: true,
  },
  order: {
    type: Number,
    default: 0,
  },
  isActive: { 
    type: Boolean, 
    default: true 
  }
}, {
  timestamps: true
});

const Testimonial = model<ITestimonial>('Testimonial', testimonialSchema);

export default Testimonial;
