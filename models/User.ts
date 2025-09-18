import { Schema, model, Document } from 'mongoose';

// Interface para tipar el documento de usuario
export interface IUser extends Document {
  email: string;
  password: string; // Hasheado con bcrypt
  name: string;
  createdAt: Date;
  role: 'admin' | 'user';
}

const userSchema = new Schema<IUser>({
  email: {
    type: String,
    required: [true, 'El email es obligatorio'],
    unique: true,
    trim: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Por favor, introduce un email válido',
    ],
  },
  password: {
    type: String,
    required: [true, 'La contraseña es obligatoria'],
    minlength: [6, 'La contraseña debe tener al menos 6 caracteres'],
  },
  name: {
    type: String,
    required: [true, 'El nombre es obligatorio'],
    trim: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  role: {
    type: String,
    enum: ['admin', 'user'],
    default: 'user',
  },
});

const User = model<IUser>('User', userSchema);

export default User;