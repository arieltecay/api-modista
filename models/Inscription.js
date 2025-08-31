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
  fechaInscripcion: {
    type: Date,
    default: Date.now,
  },
});

InscriptionSchema.plugin(mongoosePaginate);

export default mongoose.model('Inscription', InscriptionSchema);