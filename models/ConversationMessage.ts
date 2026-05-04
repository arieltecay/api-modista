import mongoose, { Schema, Document } from 'mongoose';

export interface IConversationMessage extends Document {
  platform: 'whatsapp' | 'instagram' | 'web'; // Diferenciación de canal
  platform_id: string; // ID único del remitente en la plataforma
  body: string;
  direction: 'inbound' | 'outbound';
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: Date;
}

const ConversationMessageSchema: Schema = new Schema({
  platform: { type: String, enum: ['whatsapp', 'instagram', 'web'], required: true },
  platform_id: { type: String, required: true, index: true }, // Remitente/Chat ID
  body: { type: String, required: true },
  direction: { type: String, enum: ['inbound', 'outbound'], required: true },
  status: { type: String, enum: ['sent', 'delivered', 'read', 'failed'], default: 'sent' },
  timestamp: { type: Date, default: Date.now },
});

export default mongoose.model<IConversationMessage>('ConversationMessage', ConversationMessageSchema);
