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
  /** Ausente en reglas anteriores: se interpreta como 'gemini'. */
  instagramResponseMode: 'gemini' | 'fixed';
  createdAt: Date;
  updatedAt: Date;
  /** Texto que se envía tal cual en modo 'fixed'; se conserva al volver a 'gemini'. */
  instagramFixedResponse?: string;
  whatsappFixedReplyEnabled?: boolean;
  whatsappKeywords?: string[];
  whatsappFixedResponse?: string;
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
  instagramCommentReply: { type: Boolean, default: false },
  instagramResponseMode: { type: String, enum: ['gemini', 'fixed'], default: 'gemini' },
  instagramFixedResponse: { type: String },
  whatsappFixedReplyEnabled: { type: Boolean, default: false },
  whatsappKeywords: { type: [String], default: [] },
  whatsappFixedResponse: { type: String },
}, {
  timestamps: true
});

// Índice por orden para facilitar el ensamblado
BotInstructionSchema.index({ order: 1 });

export default mongoose.model<IBotInstruction>('BotInstruction', BotInstructionSchema);
