export type AcquisitionSignalChannel = 'browser_pixel' | 'server_capi';

export type AcquisitionSignalStatus = 'invoked' | 'accepted' | 'delivered' | 'pending' | 'retry' | 'exhausted';

const STATUSES_BY_CHANNEL: Record<AcquisitionSignalChannel, readonly AcquisitionSignalStatus[]> = {
  // The browser never receives Meta's confirmation: the only honest state is "fbq was called".
  browser_pixel: ['invoked'],
  server_capi: ['accepted', 'delivered', 'pending', 'retry', 'exhausted'],
};

/** Schema validators do not run on upserts/updates; writers must call this before `findOneAndUpdate`. */
export const isStatusValidForChannel = (channel: AcquisitionSignalChannel, status: AcquisitionSignalStatus): boolean =>
  STATUSES_BY_CHANNEL[channel].includes(status);

export interface AcquisitionSignalAttemptPersistence {
  eventId: string;
  channel: AcquisitionSignalChannel;
  status: AcquisitionSignalStatus;
  attempts: number;
  occurredAt: Date;
  updatedAt: Date;
  visitorId?: string;
  visitId?: string;
  latencyMs?: number;
  errorCode?: string;
}
