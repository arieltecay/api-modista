import mongoose from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

const InscriptionSchema = new mongoose.Schema({
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

InscriptionSchema.plugin(mongoosePaginate);

export default mongoose.model('Inscription', InscriptionSchema);