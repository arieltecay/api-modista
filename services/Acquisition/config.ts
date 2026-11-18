type Env = Record<string, string | undefined>;

const PAYMENT_GATEWAY_HOSTS = ['mercadopago.com.ar', 'mercadopago.com', 'mercadolibre.com.ar', 'mercadolibre.com'];

const normalizeHost = (host: string): string => host.trim().toLowerCase().replace(/^www\./, '');

const hostOfOrigin = (origin: string): string | undefined => {
  try {
    return normalizeHost(new URL(origin.trim()).hostname);
  } catch {
    return undefined;
  }
};

/** Feature flag: anything but the exact string "true" keeps ingestion switched off. */
export const isAcquisitionTrackingEnabled = (env: Env = process.env): boolean =>
  env.ACQUISITION_TRACKING_ENABLED === 'true';

/** Referrers that are the site itself or the payment return, never an acquisition source. */
export const getIgnoredReferrerHosts = (env: Env = process.env): string[] => {
  const siteHosts = (env.CORS_ORIGIN ?? '').split(',').map(hostOfOrigin);
  const explicitHosts = (env.ACQUISITION_IGNORED_REFERRER_HOSTS ?? '').split(',').map(normalizeHost);
  const all = [...PAYMENT_GATEWAY_HOSTS, ...siteHosts, ...explicitHosts];
  return [...new Set(all.filter((host): host is string => Boolean(host)))];
};
