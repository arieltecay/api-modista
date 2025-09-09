import { Schema, model, Document } from 'mongoose';

// Interface para tipar el documento de curso
export interface ICourse extends Document {
  title: string;
  shortDescription: string;
  longDescription: string;
  imageUrl: string;
  category: string;
  deeplink?: string;
  videoUrl?: string;
  price: number;
}

const courseSchema = new Schema<ICourse>({
  title: { type: String, required: true },
  shortDescription: { type: String, required: true },
  longDescription: { type: String, required: true },
  imageUrl: { type: String, required: true },
  category: { type: String, required: true },
  deeplink: { type: String },
  videoUrl: { type: String },
  price: { type: Number, required: true },
});

const Course = model<ICourse>('Course', courseSchema);

export default Course;
