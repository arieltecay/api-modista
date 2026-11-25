import mongoose, { Schema } from 'mongoose';

const LineSchema = new Schema(
  {
    description: { type: String, required: true },
    quantity: { type: Number, required: true },
    unitPrice: { type: Number, required: true },
  },
  { _id: false }
);

/** Nota de Crédito C that cancels a whole invoice. It never changes the invoice itself. */
const CreditNoteSchema = new Schema(
  {
    /** One credit note per invoice: the unique index is what stops a double click. */
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true, unique: true },
    /** Snapshot of the credited invoice, as printed and as sent to ARCA. */
    creditedInvoice: {
      pointOfSale: { type: Number, required: true },
      number: { type: Number, required: true },
      issueDate: { type: Date, required: true },
    },
    /** Internal: why the admin issued it. Never printed nor emailed. */
    reason: { type: String, required: true },
    /** Admin user id. */
    createdBy: { type: String, required: true },
    status: { type: String, enum: ['pending', 'authorized', 'failed'], default: 'pending', required: true },
    environment: { type: String, enum: ['homologation', 'production'], required: true },
    pointOfSale: { type: Number, required: true },
    /** Reserved before asking ARCA, so a lost answer can be reconciled with FECompConsultar. */
    number: { type: Number },
    cae: { type: String },
    /** CAE expiration, YYYY-MM-DD. */
    caeExpiresAt: { type: String },
    issuedAt: { type: Date, required: true },
    total: { type: Number, required: true },
    lines: { type: [LineSchema], required: true },
    receiver: {
      name: { type: String, required: true },
      email: { type: String, required: true },
    },
    emitter: {
      legalName: { type: String, required: true },
      cuit: { type: String, required: true },
      address: { type: String, required: true },
      ivaCondition: { type: String, required: true },
    },
    fiscalQrUrl: { type: String },
    /** 256-bit random token of the public page; different from the invoice's. */
    publicToken: { type: String, required: true, unique: true },
    attempts: { type: Number, default: 0 },
    lastError: { type: String },
    /** Lease so two workers (admin and cron) never issue the same note at once. */
    lockedUntil: { type: Date, default: null },
    emailSentAt: { type: Date },
  },
  { timestamps: true }
);

CreditNoteSchema.index(
  { environment: 1, pointOfSale: 1, number: 1 },
  { unique: true, partialFilterExpression: { status: 'authorized' } }
);
CreditNoteSchema.index({ status: 1, updatedAt: 1 });

export default mongoose.model('CreditNote', CreditNoteSchema);
