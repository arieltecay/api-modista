import ArcaToken from '../../models/ArcaToken/index.js';
import type { ArcaConfig, ArcaTicketStore } from './types.js';

export const createMongoTicketStore = (environment: ArcaConfig['environment'], cuit: string): ArcaTicketStore => {
  const key = `${environment}:${cuit}`;
  return {
    load: async () => {
      const stored = await ArcaToken.findOne({ key }).lean();
      return stored ? { token: stored.token, sign: stored.sign, expiresAt: stored.expiresAt } : null;
    },
    save: async (ticket) => {
      await ArcaToken.updateOne({ key }, { $set: ticket }, { upsert: true });
    },
    clear: async () => {
      await ArcaToken.deleteOne({ key });
    },
  };
};
