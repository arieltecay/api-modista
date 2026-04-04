import { Schema, model, Document, Types, PaginateModel } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

export interface IMonthlyClosureReport extends Document {
  courseId: Types.ObjectId;
  closureDate: Date;
  paymentMonth: number;
  paymentYear: number;
  totalAmountCollected: number;
  reportUrl: string;
  generatedAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

interface IMonthlyClosureReportModel extends PaginateModel<IMonthlyClosureReport> { }

const MonthlyClosureReportSchema = new Schema<IMonthlyClosureReport>({
  courseId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Course', 
    required: [true, 'El ID del curso es obligatorio'],
    index: true 
  },
  closureDate: { 
    type: Date, 
    required: [true, 'La fecha de cierre es obligatoria'] 
  },
  paymentMonth: { 
    type: Number, 
    required: [true, 'El mes de pago es obligatorio'] 
  },
  paymentYear: { 
    type: Number, 
    required: [true, 'El año de pago es obligatorio'] 
  },
  totalAmountCollected: { 
    type: Number, 
    required: [true, 'El total recaudado es obligatorio'],
    min: [0, 'El total recaudado no puede ser negativo']
  },
  reportUrl: { 
    type: String, 
    required: [true, 'La URL del reporte es obligatoria'] 
  },
  generatedAt: { 
    type: Date, 
    default: Date.now 
  },
}, {
  timestamps: true
});

MonthlyClosureReportSchema.plugin(mongoosePaginate);

// Índices para búsquedas rápidas
MonthlyClosureReportSchema.index({ courseId: 1, closureDate: -1 });
MonthlyClosureReportSchema.index({ paymentYear: 1, paymentMonth: 1 });

const MonthlyClosureReport = model<IMonthlyClosureReport, IMonthlyClosureReportModel>('MonthlyClosureReport', MonthlyClosureReportSchema);

export default MonthlyClosureReport;
