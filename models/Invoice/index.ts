import mongoose, { Schema } from 'mongoose';

const LineSchema = new Schema(
  {
    description: { type: String, required: true },
    quantity: { type: Number, required: true },
    unitPrice: { type: Number, required: true },
  },
  { _id: false }
);

const InvoiceSchema = new Schema(
  {
    /** One invoice per inscription: the unique index is what makes issuing idempotent. */
    inscriptionId: { type: Schema.Types.ObjectId, ref: 'Inscription', required: true, unique: true },
    mpPaymentId: { type: String },
    status: { type: String, enum: ['pending', 'authorized', 'failed'], default: 'pending', required: true },
    environment: { type: String, enum: ['homologation', 'production'], required: true },
    pointOfSale: { type: Number, required: true },
    /** Reserved before asking ARCA, so a lost answer can be reconciled with FECompConsultar. */
    number: { type: Number },
    cae: { type: String },
    /** CAE expiration, YYYY-MM-DD. */
    caeExpiresAt: { type: String },
    /** Issue date sent to ARCA; kept from the first attempt so retries reconcile on the same day. */
    issuedAt: { type: Date, required: true },
    total: { type: Number, required: true },
    lines: { type: [LineSchema], required: true },
    receiver: {
      name: { type: String, required: true },
      email: { type: String, required: true },
    },
    /** Snapshot of the emitter at issue time. */
    emitter: {
      legalName: { type: String, required: true },
      cuit: { type: String, required: true },
      address: { type: String, required: true },
      ivaCondition: { type: String, required: true },
    },
    fiscalQrUrl: { type: String },
    /** 256-bit random token of the public invoice page; never derivable from other fields. */
    publicToken: { type: String, required: true, unique: true },
    attempts: { type: Number, default: 0 },
    lastError: { type: String },
    /** Lease so two workers (webhook and cron) never issue the same invoice at once. */
    lockedUntil: { type: Date, default: null },
    emailSentAt: { type: Date },
  },
  { timestamps: true }
);

// A number can be authorized only once per environment and point of sale.
InvoiceSchema.index(
  { environment: 1, pointOfSale: 1, number: 1 },
  { unique: true, partialFilterExpression: { status: 'authorized' } }
);
InvoiceSchema.index({ status: 1, createdAt: 1 });

export default mongoose.model('Invoice', InvoiceSchema);
