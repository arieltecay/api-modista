import { Schema, model, Document, Types } from 'mongoose';

export interface ITurno extends Document {
    courseId: Types.ObjectId;
    diaSemana?: string; // Ej: 'Martes'
    fecha?: Date;      // Para fechas específicas alternativamente
    horaInicio: string; // Ej: '09:00'
    horaFin: string;    // Ej: '11:00'
    cupoMaximo: number;
    cuposInscriptos: number;
    isActive: boolean;
    isBlocked: boolean;
}

const TurnoSchema = new Schema<ITurno>({
    courseId: {
        type: Schema.Types.ObjectId,
        ref: 'Course',
        required: [true, 'El ID del curso es obligatorio'],
    },
    diaSemana: {
        type: String,
        trim: true,
    },
    fecha: {
        type: Date,
    },
    horaInicio: {
        type: String,
        required: [true, 'La hora de inicio es obligatoria'],
        trim: true,
    },
    horaFin: {
        type: String,
        required: [true, 'La hora de fin es obligatoria'],
        trim: true,
    },
    cupoMaximo: {
        type: Number,
        required: [true, 'El cupo máximo es obligatorio'],
        default: 4,
    },
    cuposInscriptos: {
        type: Number,
        default: 0,
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    isBlocked: {
        type: Boolean,
        default: false,
    },
}, {
    timestamps: true,
});

const Turno = model<ITurno>('Turno', TurnoSchema);

export default Turno;
