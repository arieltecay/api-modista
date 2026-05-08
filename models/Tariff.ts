import { Schema, model, Document } from 'mongoose';

interface IPeriod {
  inicio: string;
  fin: string;
}

interface IContacto {
  email: string;
  nota: string;
}

interface ITariffMetadataNew {
  titulo: string;
  organizacion: string;
  periodo: IPeriod;
  descripcion: string;
  nota_precios: string;
  nota_adicional: string;
  moneda: string;
  contacto?: IContacto;
  ultimaActualizacion?: string;
  version?: string;
  notas?: string[];
}
const PeriodSchema = new Schema<IPeriod>({
  inicio: { type: String, required: false, default: '' },
  fin: { type: String, required: false, default: '' },
}, { _id: false });

const ContactoSchema = new Schema<IContacto>({
  email: { type: String, required: false, default: '' },
  nota: { type: String, required: false, default: '' },
}, { _id: false });

const TariffMetadataNewSchema = new Schema<ITariffMetadataNew>({
  titulo: { type: String, required: true },
  organizacion: { type: String, default: 'Modista' },
  periodo: { type: PeriodSchema, required: false, default: () => ({}) },
  descripcion: { type: String, required: false, default: '' },
  nota_precios: { type: String, required: false, default: '' },
  nota_adicional: { type: String, required: false, default: '' },
  moneda: { type: String, default: 'ARS' },
  contacto: { type: ContactoSchema, required: false, default: () => ({}) },
  ultimaActualizacion: { type: String },
  version: { type: String },
  notas: [{ type: String }],
}, { _id: false });


export interface ITariff extends Document {
  type: string;
  periodIdentifier: string;
  startDate: Date;
  status: 'active' | 'inactive';
  metadata: ITariffMetadataNew;
  content: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

const TariffSchema = new Schema<ITariff>({
  type: { type: String, required: true, unique: false },
  periodIdentifier: { type: String, required: true },
  startDate: { type: Date, required: true },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  metadata: { type: TariffMetadataNewSchema, required: true },
  content: { type: Schema.Types.Mixed, required: true },
}, {
  timestamps: true,
});
TariffSchema.index({ type: 1, periodIdentifier: 1 }, { unique: true });

const Tariff = model<ITariff>('Tariff', TariffSchema);

export default Tariff;
