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
  contacto: IContacto;
  ultimaActualizacion?: string;
  version?: string;
  notas?: string[];
}
const PeriodSchema = new Schema<IPeriod>({
  inicio: { type: String, required: true },
  fin: { type: String, required: true },
});
const ContactoSchema = new Schema<IContacto>({
  email: { type: String, required: true },
  nota: { type: String, required: true },
});
const TariffMetadataNewSchema = new Schema<ITariffMetadataNew>({
  titulo: { type: String, required: true },
  organizacion: { type: String, required: true },
  periodo: { type: PeriodSchema, required: true },
  descripcion: { type: String, required: true },
  nota_precios: { type: String, required: true },
  nota_adicional: { type: String, required: true },
  moneda: { type: String, required: true },
  contacto: { type: ContactoSchema, required: true },
  ultimaActualizacion: { type: String },
  version: { type: String },
  notas: [{ type: String }],
});


export interface ITariff extends Document {
  type: string;
  periodIdentifier: string;
  startDate: Date;
  metadata: ITariffMetadataNew;
  content: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

const TariffSchema = new Schema<ITariff>({
  type: { type: String, required: true, unique: false },
  periodIdentifier: { type: String, required: true },
  startDate: { type: Date, required: true },
  metadata: { type: TariffMetadataNewSchema, required: true },
  content: { type: Schema.Types.Mixed, required: true },
}, {
  timestamps: true,
});
TariffSchema.index({ type: 1, periodIdentifier: 1 }, { unique: true });

const Tariff = model<ITariff>('Tariff', TariffSchema);

export default Tariff;
