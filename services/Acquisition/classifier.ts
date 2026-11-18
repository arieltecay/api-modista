import {
  AD_TOKEN,
  EMAIL_MEDIUMS,
  EMPTY_VALUES,
  HOST_RULES,
  MEDIUM_KIND,
  MESSAGING_MEDIUMS,
  PAID_CHANNEL,
  PAID_MEDIUMS,
  REFERRAL_MEDIUM,
  SEARCH_MEDIUMS,
  SOCIAL_CHANNEL,
  SOCIAL_MEDIUMS,
  SOURCE_ALIASES,
  SOURCE_FAMILIES,
} from './taxonomy.js';
import type {
  AcquisitionType,
  ChannelGroup,
  Classification,
  ClassificationReason,
  ClassificationRule,
  ClassifierInput,
  HostMatch,
  Signals,
  SourcePlatform,
} from './types.js';

export const CLASSIFIER_VERSION = 1;

const build = (
  sourcePlatform: SourcePlatform,
  acquisitionType: AcquisitionType,
  channelGroup: ChannelGroup,
  reason: ClassificationReason,
): Classification => ({
  sourcePlatform,
  acquisitionType,
  channelGroup,
  reason,
  classifierVersion: CLASSIFIER_VERSION,
});

const normalizeToken = (value?: string): string => {
  const token = (value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return EMPTY_VALUES.has(token) ? '' : token;
};

const normalizeHost = (value?: string): string =>
  (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^([a-z][a-z0-9+.-]*:)?\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/^[^@]*@/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '');

const matchHost = (host: string): HostMatch | undefined =>
  HOST_RULES.find(([pattern]) => pattern.test(host))?.[1];

const resolveFamily = (source: string): HostMatch | undefined => {
  for (const { names, match } of SOURCE_FAMILIES) {
    for (const name of names) {
      if (source === name) return match;
      if (source.startsWith(`${name}_`)) return { ...match, ad: AD_TOKEN.test(source.slice(name.length + 1)) };
    }
  }
  return undefined;
};

const resolveSource = (source: string): HostMatch | undefined =>
  resolveFamily(source) ??
  SOURCE_ALIASES.get(source) ??
  (source.includes('.') ? matchHost(normalizeHost(source)) : undefined);

const readSignals = (input: ClassifierInput): Signals => {
  const source = normalizeToken(input.source);
  const campaign = normalizeToken(input.campaign);
  const referrerHost = normalizeHost(input.referrerHost);
  const referrer = referrerHost ? matchHost(referrerHost) : undefined;
  const sourceMatch = source ? resolveSource(source) : undefined;
  const paidCampaigns = (input.paidCampaigns ?? []).map(normalizeToken);

  return {
    source,
    campaign,
    referrerHost,
    medium: normalizeToken(input.medium),
    platform: sourceMatch?.platform ?? (source ? 'other' : (referrer?.platform ?? 'unknown')),
    platformOrigin: source ? 'source' : 'referrer',
    kind: source ? sourceMatch?.kind : referrer?.kind,
    paidCampaign: campaign !== '' && paidCampaigns.includes(campaign),
    sourceIsAd: sourceMatch?.ad === true,
  };
};

const isPaidMedium = (medium: string): boolean => PAID_MEDIUMS.has(medium) || medium.startsWith('paid_');

const classifyPaid: ClassificationRule = (signals) => {
  const byMedium = isPaidMedium(signals.medium);
  if (!byMedium && !signals.paidCampaign && !signals.sourceIsAd) return undefined;
  if (signals.platform === 'unknown') return build('unknown', 'unknown', 'unknown', 'paid_signal_without_platform');
  if (signals.platform === 'other' && !signals.kind) {
    return build('other', 'unknown', 'unknown', 'paid_signal_unrecognized_platform');
  }
  if (signals.platform === 'email') {
    return build('email', 'unknown', 'unknown', 'paid_signal_contradicts_email_source');
  }
  const channel = PAID_CHANNEL[signals.platform] ?? 'other_paid';
  const reason = byMedium ? 'paid_medium' : signals.paidCampaign ? 'paid_campaign_mapped' : 'paid_source_alias';
  return build(signals.platform, 'paid', channel, reason);
};

/** A UTM source of one kind (e.g. google) with a medium of another (e.g. social) cannot be trusted. */
const classifyConflict: ClassificationRule = ({ platform, platformOrigin, kind, medium }) => {
  const mediumKind = MEDIUM_KIND.get(medium);
  if (platformOrigin !== 'source' || !kind || !mediumKind || kind === mediumKind) return undefined;
  // `utm_source=whatsapp&utm_medium=social` is what WhatsApp share buttons produce.
  if (kind === 'messaging' && mediumKind === 'social') return undefined;
  return build(platform, 'unknown', 'unknown', 'source_medium_conflict');
};

const classifyEmail: ClassificationRule = ({ kind, medium }) => {
  if (kind !== 'email' && !EMAIL_MEDIUMS.has(medium)) return undefined;
  return build('email', 'email', 'email', EMAIL_MEDIUMS.has(medium) ? 'email_medium' : 'email_source');
};

const classifyMessaging: ClassificationRule = ({ kind, medium }) => {
  if (kind !== 'messaging' && !MESSAGING_MEDIUMS.has(medium)) return undefined;
  return build('whatsapp', 'messaging', 'whatsapp', 'messaging');
};

const classifySocial: ClassificationRule = ({ kind, medium, platform, platformOrigin }) => {
  const byMedium = SOCIAL_MEDIUMS.has(medium);
  if (!byMedium && kind !== 'social') return undefined;
  if (platform === 'unknown') return build('unknown', 'unknown', 'unknown', 'social_medium_without_platform');
  const reason = byMedium
    ? 'social_medium'
    : platformOrigin === 'source'
      ? 'social_source_without_paid_medium'
      : 'social_referrer';
  return build(platform, 'organic_social', SOCIAL_CHANNEL[platform] ?? 'other_social', reason);
};

const classifySearch: ClassificationRule = ({ kind, medium, platform, platformOrigin }) => {
  const byMedium = SEARCH_MEDIUMS.has(medium);
  if (!byMedium && kind !== 'search') return undefined;
  if (byMedium && platformOrigin === 'source' && kind !== 'search') return undefined;
  const reason = byMedium
    ? 'search_medium'
    : platformOrigin === 'source'
      ? 'search_source_without_paid_medium'
      : 'search_referrer';
  const channel = platform === 'google' ? 'google_organic' : 'other_search';
  return build(platform, 'organic_search', channel, reason);
};

const classifyReferral: ClassificationRule = ({ medium, referrerHost }) => {
  if (medium !== REFERRAL_MEDIUM && !referrerHost) return undefined;
  return build('other', 'referral', 'referral', medium === REFERRAL_MEDIUM ? 'referral_medium' : 'referral_referrer');
};

const classifyDirect: ClassificationRule = ({ source, medium, campaign, referrerHost }) =>
  source || medium || campaign || referrerHost ? undefined : build('unknown', 'direct', 'direct', 'direct_no_signals');

/** Order is the precedence documented in the acquisition plan (section 7). */
const RULES: readonly ClassificationRule[] = [
  classifyConflict,
  classifyPaid,
  classifyEmail,
  classifyMessaging,
  classifySocial,
  classifySearch,
  classifyReferral,
  classifyDirect,
];

export const classifyAcquisition = (input: ClassifierInput): Classification => {
  const signals = readSignals(input);
  for (const rule of RULES) {
    const result = rule(signals);
    if (result) return result;
  }
  return build(signals.platform, 'unknown', 'unknown', 'unrecognized_attribution');
};
