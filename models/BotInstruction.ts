import mongoose, { Schema, Document } from 'mongoose';

export interface IBotInstruction extends Document {
  title: string;
  content: string;
  order: number;
  isActive: boolean;
  instagramAutoReply: boolean;
  instagramKeywords: string[];
  instagramEnrollmentLookup: boolean;
  instagramCommentReply: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const BotInstructionSchema: Schema = new Schema({
  title: { 
    type: String, 
    required: true, 
    trim: true 
  },
  content: { 
    type: String, 
    required: true 
  },
  order: { 
    type: Number, 
    default: 0 
  },
  isActive: { 
    type: Boolean, 
    default: true 
  },
  instagramAutoReply: { type: Boolean, default: false },
  instagramKeywords: { type: [String], default: [] },
  instagramEnrollmentLookup: { type: Boolean, default: false },
  instagramCommentReply: { type: Boolean, default: false }
}, {
  timestamps: true
});

// Índice por orden para facilitar el ensamblado
BotInstructionSchema.index({ order: 1 });

export default mongoose.model<IBotInstruction>('BotInstruction', BotInstructionSchema);
