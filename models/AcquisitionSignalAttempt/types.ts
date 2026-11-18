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

const NON_TERMINAL_ORDER: readonly AcquisitionSignalStatus[] = ['accepted', 'pending', 'retry'];
const TERMINAL: readonly AcquisitionSignalStatus[] = ['delivered', 'exhausted'];

/** Current statuses from which `to` may be reached: forward only, and terminal states never change. */
export const statusesThatMayAdvanceTo = (to: AcquisitionSignalStatus): readonly AcquisitionSignalStatus[] =>
  TERMINAL.includes(to) ? NON_TERMINAL_ORDER : NON_TERMINAL_ORDER.slice(0, NON_TERMINAL_ORDER.indexOf(to) + 1);

export const isSignalTransitionAllowed = (from: AcquisitionSignalStatus, to: AcquisitionSignalStatus): boolean =>
  from === to || statusesThatMayAdvanceTo(to).includes(from);

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
