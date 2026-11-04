export const META_MARKETING_CONSENT_VERSION = 'privacy-2026-11';
export const META_MARKETING_CONSENT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

type ConsentHeader = string | string[] | undefined;

const getHeaderValue = (value: ConsentHeader): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export const isMetaMarketingConsentGranted = (
  consentHeader: ConsentHeader,
  versionHeader: ConsentHeader
): boolean =>
  getHeaderValue(consentHeader) === 'granted' &&
  getHeaderValue(versionHeader) === META_MARKETING_CONSENT_VERSION;

export const isMetaMarketingConsentCurrent = (consentAt: Date, now = new Date()): boolean => {
  const consentTime = consentAt.getTime();
  return Number.isFinite(consentTime)
    && consentTime <= now.getTime()
    && now.getTime() - consentTime <= META_MARKETING_CONSENT_MAX_AGE_MS;
};
