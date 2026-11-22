import mongoose, { Schema, Document } from 'mongoose';

export interface IConversationMessage extends Document {
  platform: 'whatsapp' | 'instagram' | 'web'; // Diferenciación de canal
  platform_id: string; // ID único del remitente en la plataforma
  externalMessageId?: string;
  /** Ausente = mensaje directo. `comment` = comentario público; `private_reply` = respuesta privada a un comentario. */
  kind?: 'comment' | 'private_reply';
  commentId?: string;
  body: string;
  direction: 'inbound' | 'outbound';
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: Date;
  isAdminRead: boolean;
}

const ConversationMessageSchema: Schema = new Schema({
  platform: { type: String, enum: ['whatsapp', 'instagram', 'web'], required: true },
  platform_id: { type: String, required: true, index: true }, // Remitente/Chat ID
  externalMessageId: { type: String },
  kind: { type: String, enum: ['comment', 'private_reply'] },
  commentId: { type: String },
  body: { type: String, required: true },
  direction: { type: String, enum: ['inbound', 'outbound'], required: true },
  status: { type: String, enum: ['sent', 'delivered', 'read', 'failed'], default: 'sent' },
  timestamp: { type: Date, default: Date.now },
  isAdminRead: { type: Boolean, default: false },
});

ConversationMessageSchema.index({ platform: 1, externalMessageId: 1 }, { unique: true, partialFilterExpression: { externalMessageId: { $type: 'string' } } });

export default mongoose.model<IConversationMessage>('ConversationMessage', ConversationMessageSchema);
