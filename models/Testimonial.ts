import { Schema, model, Document } from 'mongoose';

/**
 * Interface para el documento de Testimonio
 */
export interface ITestimonial extends Document {
  name: string;
  description: string;
  role?: string;
  avatarUrl?: string;
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
  isActive: { 
    type: Boolean, 
    default: true 
  }
}, {
  timestamps: true
});

const Testimonial = model<ITestimonial>('Testimonial', testimonialSchema);

export default Testimonial;
