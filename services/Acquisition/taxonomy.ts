import type { ChannelGroup, HostMatch, PlatformKind, SourceFamily, SourcePlatform } from './types.js';

/** Values analytics tools write when a field is "not set"; treated as absent. */
export const EMPTY_VALUES: ReadonlySet<string> = new Set([
  '',
  '(none)',
  '(direct)',
  'direct',
  '(not_set)',
  'not_set',
  'none',
  'null',
  'undefined',
]);

export const PAID_MEDIUMS: ReadonlySet<string> = new Set([
  'cpc',
  'ppc',
  'cpm',
  'paid',
  'paid_social',
  'paidsocial',
  'paid_search',
  'paidsearch',
  'paid_media',
  'display',
  'cpv',
  'cpa',
  'ad',
  'ads',
  'retargeting',
  'remarketing',
  'sponsored',
  'promoted',
  'boosted',
]);

export const SOCIAL_MEDIUMS: ReadonlySet<string> = new Set([
  'social',
  'social_media',
  'socialmedia',
  'social_network',
  'organic_social',
  'sm',
]);

export const SEARCH_MEDIUMS: ReadonlySet<string> = new Set(['organic', 'search', 'organic_search', 'seo']);

export const EMAIL_MEDIUMS: ReadonlySet<string> = new Set(['email', 'e_mail', 'mail', 'newsletter']);

export const MESSAGING_MEDIUMS: ReadonlySet<string> = new Set(['whatsapp', 'wa']);

export const REFERRAL_MEDIUM = 'referral';

const social = (platform: SourcePlatform): HostMatch => ({ platform, kind: 'social' });
const search = (platform: SourcePlatform): HostMatch => ({ platform, kind: 'search' });
const WHATSAPP: HostMatch = { platform: 'whatsapp', kind: 'messaging' };
const EMAIL: HostMatch = { platform: 'email', kind: 'email' };

/** Matches `ads`/`ad` as a whole token of the part after the family name (`ig_ads`, `facebook_ad_q4`). */
export const AD_TOKEN = /(^|_)ads?($|_)/;

export const SOURCE_FAMILIES: readonly SourceFamily[] = [
  { names: ['ig', 'insta', 'instagram'], match: social('instagram') },
  { names: ['fb', 'facebook', 'meta'], match: social('facebook') },
  { names: ['tiktok', 'tt'], match: social('tiktok') },
  { names: ['youtube', 'yt'], match: social('youtube') },
  { names: ['google'], match: search('google') },
  { names: ['bing'], match: search('bing') },
  { names: ['whatsapp', 'wa'], match: WHATSAPP },
];

/** Exact-name sources outside the families. Kind is part of the match so `other` can still be social/search. */
export const SOURCE_ALIASES: ReadonlyMap<string, HostMatch> = new Map<string, HostMatch>([
  ...['adwords', 'googleads', 'google_adwords'].map((k): [string, HostMatch] => [k, { ...search('google'), ad: true }]),
  ...['twitter', 'linkedin', 'pinterest', 'reddit'].map((k): [string, HostMatch] => [k, social('other')]),
  ...['yahoo', 'duckduckgo'].map((k): [string, HostMatch] => [k, search('other')]),
  ...['email', 'e_mail', 'mail', 'newsletter'].map((k): [string, HostMatch] => [k, EMAIL]),
]);

/** Each non-generic medium implies a kind; `organic` is generic (unpaid) and implies none. */
export const MEDIUM_KIND: ReadonlyMap<string, PlatformKind> = new Map<string, PlatformKind>([
  ...[...SOCIAL_MEDIUMS].map((m): [string, PlatformKind] => [m, 'social']),
  ...[...SEARCH_MEDIUMS].filter((m) => m !== 'organic').map((m): [string, PlatformKind] => [m, 'search']),
  ...[...EMAIL_MEDIUMS].map((m): [string, PlatformKind] => [m, 'email']),
  ...[...MESSAGING_MEDIUMS].map((m): [string, PlatformKind] => [m, 'messaging']),
  ...['paid_social', 'paidsocial'].map((m): [string, PlatformKind] => [m, 'social']),
  ...['paid_search', 'paidsearch'].map((m): [string, PlatformKind] => [m, 'search']),
]);

/** Ordered: webmail hosts must precede the generic google/yahoo patterns. */
export const HOST_RULES: ReadonlyArray<readonly [RegExp, HostMatch]> = [
  [/^(mail\.google\.com|outlook\.live\.com|outlook\.office\.com|outlook\.com|mail\.live\.com|mail\.yahoo\.com|com\.google\.android\.gm)$/, EMAIL],
  [/^com\.instagram\.android$/, social('instagram')],
  [/^com\.facebook\./, social('facebook')],
  [/^com\.whatsapp(\.|$)/, WHATSAPP],
  [/(^|\.)instagram\.com$/, social('instagram')],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|m\.me)$/, social('facebook')],
  [/(^|\.)tiktok\.com$/, social('tiktok')],
  [/(^|\.)(youtube\.com|youtu\.be)$/, social('youtube')],
  [/(^|\.)(twitter\.com|x\.com|t\.co|linkedin\.com|lnkd\.in|pinterest\.com|reddit\.com)$/, social('other')],
  [/(^|\.)(wa\.me|whatsapp\.com)$/, WHATSAPP],
  /** Only the search front-ends (google.com / ccTLDs): docs, drive, google.org, google.dev are plain referrals. */
  [/^google\.(com|[a-z]{2})(\.[a-z]{2})?$/, search('google')],
  [/(^|\.)bing\.com$/, search('bing')],
  [/(^|\.)(duckduckgo\.com|yahoo\.com|ecosia\.org)$/, search('other')],
];

export const PAID_CHANNEL: Readonly<Partial<Record<SourcePlatform, ChannelGroup>>> = {
  instagram: 'meta_paid',
  facebook: 'meta_paid',
  google: 'google_paid',
};

export const SOCIAL_CHANNEL: Readonly<Partial<Record<SourcePlatform, ChannelGroup>>> = {
  instagram: 'instagram_organic',
  facebook: 'facebook_organic',
};
