import { Schema, model, Document } from 'mongoose';

export interface ICarouselConfig extends Document {
  title: string;
  subtitle?: string;
  imageUrl: string;
  imagePublicId: string;
  link: string;
  buttonText: string;
  order: number;
  isActive: boolean;
  publishAt?: Date;
  expireAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const carouselConfigSchema = new Schema<ICarouselConfig>({
  title: { type: String, required: true },
  subtitle: { type: String },
  imageUrl: { type: String, required: true },
  imagePublicId: { type: String, required: true },
  link: { type: String, required: true },
  buttonText: { type: String, required: true, default: 'Ver más' },
  order: { type: Number, required: true, default: 0 },
  isActive: { type: Boolean, required: true, default: true },
  publishAt: { type: Date },
  expireAt: { type: Date }
}, {
  timestamps: true
});

const CarouselConfig = model<ICarouselConfig>('CarouselConfig', carouselConfigSchema);

export default CarouselConfig;
