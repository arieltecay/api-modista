import mongoose, { Schema } from 'mongoose';

/** WSAA access ticket shared by every serverless instance (ARCA refuses a new one while it is valid). */
const ArcaTokenSchema = new Schema(
  {
    /** `<environment>:<cuit>`. */
    key: { type: String, required: true, unique: true },
    token: { type: String, required: true },
    sign: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

export default mongoose.model('ArcaToken', ArcaTokenSchema);
