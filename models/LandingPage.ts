import { Schema, model, Document, PaginateModel } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

export interface ILandingPage extends Document {
  title: string;
  slug: string;
  courseId: string;
  status: 'active' | 'inactive';
  customTitle?: string;
  customDescription?: string;
  buttonText?: string;
  videoUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ILandingPageModel extends PaginateModel<ILandingPage> { }

const LandingPageSchema = new Schema<ILandingPage>({
  title: { 
    type: String, 
    required: [true, 'El título interno es obligatorio'], 
    trim: true 
  },
  slug: { 
    type: String, 
    required: [true, 'El slug de la URL es obligatorio'], 
    unique: true, 
    trim: true,
    lowercase: true 
  },
  courseId: { 
    type: String, 
    required: [true, 'El ID del curso asociado es obligatorio'] 
  },
  status: { 
    type: String, 
    enum: ['active', 'inactive'], 
    default: 'active' 
  },
  customTitle: { 
    type: String, 
    trim: true 
  },
  customDescription: { 
    type: String, 
    trim: true 
  },
  buttonText: { 
    type: String, 
    default: 'Inscribirme Ahora', 
    trim: true 
  },
  videoUrl: { 
    type: String, 
    trim: true 
  },
}, {
  timestamps: true
});

LandingPageSchema.plugin(mongoosePaginate);

const LandingPage = model<ILandingPage, ILandingPageModel>('LandingPage', LandingPageSchema);

export default LandingPage;
