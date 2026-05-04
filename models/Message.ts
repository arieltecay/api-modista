import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage extends Document {
  jid: string; // WhatsApp unique identifier (phone number)
  body: string;
  direction: 'inbound' | 'outbound';
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: Date;
}

const MessageSchema: Schema = new Schema({
  jid: { type: String, required: true, index: true },
  body: { type: String, required: true },
  direction: { type: String, enum: ['inbound', 'outbound'], required: true },
  status: { type: String, enum: ['sent', 'delivered', 'read', 'failed'], default: 'sent' },
  timestamp: { type: Date, default: Date.now },
});

export default mongoose.model<IMessage>('Message', MessageSchema);
