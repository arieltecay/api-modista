import { Schema, model, Document, PaginateModel } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

export interface IFAQ extends Document {
  question: string;
  answer: string;
  iconName?: string;
  category: 'general' | 'purchase-process' | 'courses';
  order: number;
  status: 'active' | 'inactive';
  createdAt?: Date;
  updatedAt?: Date;
}

interface IFAQModel extends PaginateModel<IFAQ> { }

const faqSchema = new Schema<IFAQ>({
  question: { 
    type: String, 
    required: true,
    trim: true 
  },
  answer: { 
    type: String, 
    required: true,
    trim: true 
  },
  iconName: { 
    type: String, 
    default: 'help-circle' 
  },
  category: { 
    type: String, 
    enum: ['general', 'purchase-process', 'courses'],
    default: 'general' 
  },
  order: { 
    type: Number, 
    default: 0 
  },
  status: { 
    type: String, 
    enum: ['active', 'inactive'], 
    default: 'active' 
  }
}, {
  timestamps: true
});

faqSchema.plugin(mongoosePaginate);

const FAQ = model<IFAQ, IFAQModel>('FAQ', faqSchema);

export default FAQ;
