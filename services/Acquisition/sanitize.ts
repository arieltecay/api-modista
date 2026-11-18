export const CLIENT_CLOCK_MAX_AGE_MS = 48 * 60 * 60 * 1000;
export const CLIENT_CLOCK_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/** Client clocks drift and tabs retry late: accept a bounded window around the server time. */
export const isWithinClientClockWindow = (date: Date, now = new Date()): boolean => {
  const delta = date.getTime() - now.getTime();
  return Number.isFinite(delta) && delta <= CLIENT_CLOCK_FUTURE_TOLERANCE_MS && delta >= -CLIENT_CLOCK_MAX_AGE_MS;
};

/** Drops query and hash (they can carry emails or click ids); only site-relative paths survive. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f\u2028\u2029]/;
const MAX_HOST_LENGTH = 253;

export const toCleanPath = (value: string): string | undefined => {
  // split() instead of a `.*` regex: `.` does not match line breaks, which would leave the query behind.
  const path = value.split(/[?#]/, 1)[0];
  return path.startsWith('/') && !path.startsWith('//') && !CONTROL_CHARACTERS.test(path) ? path : undefined;
};

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Reduces a referrer to its bare host; own sites and payment gateways are not an acquisition source. */
export const toReferrerHost = (referrer: string | undefined, ignoredHosts: readonly string[]): string | undefined => {
  const trimmed = referrer?.trim();
  if (!trimmed) return undefined;

  let url: URL;
  try {
    url = new URL(SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;

  const host = url.hostname.replace(/^www\./, '').replace(/\.$/, '');
  const ignored = ignoredHosts.some((ignoredHost) => host === ignoredHost || host.endsWith(`.${ignoredHost}`));
  return host && host.length <= MAX_HOST_LENGTH && !ignored ? host : undefined;
};
