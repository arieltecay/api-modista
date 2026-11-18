import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyAcquisition, CLASSIFIER_VERSION } from './classifier.js';
import type { AcquisitionType, ChannelGroup, ClassificationReason, ClassifierInput, SourcePlatform } from './types.js';

type Expected = [
  sourcePlatform: SourcePlatform,
  acquisitionType: AcquisitionType,
  channelGroup: ChannelGroup,
  reason?: ClassificationReason,
];

const CASES: Array<[name: string, input: ClassifierInput, expected: Expected]> = [
  ['Instagram paid_social', { source: 'instagram', medium: 'paid_social', campaign: 'c1' }, ['instagram', 'paid', 'meta_paid']],
  ['Instagram organic social', { source: 'instagram', medium: 'social' }, ['instagram', 'organic_social', 'instagram_organic']],
  ['Facebook organic by referrer', { referrerHost: 'l.facebook.com' }, ['facebook', 'organic_social', 'facebook_organic']],
  ['Instagram organic by referrer URL', { referrerHost: 'https://www.Instagram.com/p/abc?x=1' }, ['instagram', 'organic_social', 'instagram_organic']],
  ['Google organic by referrer', { referrerHost: 'www.google.com' }, ['google', 'organic_search', 'google_organic']],
  ['Google organic by medium', { source: 'google', medium: 'organic' }, ['google', 'organic_search', 'google_organic']],
  ['Google paid cpc', { source: 'google', medium: 'cpc', campaign: 'c2' }, ['google', 'paid', 'google_paid']],
  ['Bing paid is other_paid', { source: 'bing', medium: 'cpc' }, ['bing', 'paid', 'other_paid']],
  ['TikTok paid is other_paid', { source: 'tiktok', medium: 'paid_social' }, ['tiktok', 'paid', 'other_paid']],
  ['WhatsApp by source', { source: 'whatsapp', medium: 'messaging' }, ['whatsapp', 'messaging', 'whatsapp']],
  ['WhatsApp by medium', { medium: 'whatsapp' }, ['whatsapp', 'messaging', 'whatsapp']],
  ['WhatsApp by referrer', { referrerHost: 'wa.me' }, ['whatsapp', 'messaging', 'whatsapp']],
  ['Email by UTM', { source: 'newsletter', medium: 'email' }, ['email', 'email', 'email']],
  ['Referral by external referrer', { referrerHost: 'blog.example.com' }, ['other', 'referral', 'referral']],
  ['Referral by medium', { source: 'partner-site', medium: 'referral' }, ['other', 'referral', 'referral']],
  ['Direct without signals', {}, ['unknown', 'direct', 'direct']],
  ['Direct with placeholder medium', { medium: '(none)' }, ['unknown', 'direct', 'direct']],
  ['Contradictory email source with paid medium', { source: 'email', medium: 'cpc' }, ['email', 'unknown', 'unknown', 'paid_signal_contradicts_email_source']],
  ['Paid medium without any platform', { medium: 'cpc' }, ['unknown', 'unknown', 'unknown', 'paid_signal_without_platform']],
  ['Unrecognized UTM without referrer', { source: 'foo', medium: 'bar' }, ['other', 'unknown', 'unknown']],
  ['Unrecognized UTM with external referrer', { source: 'foo', medium: 'bar', referrerHost: 'blog.example.com' }, ['other', 'referral', 'referral']],
  ['Aliases and casing: " IG " + "Paid Social"', { source: ' IG ', medium: 'Paid Social' }, ['instagram', 'paid', 'meta_paid']],
  ['Aliases and casing: Facebook + PAID-SOCIAL', { source: 'Facebook', medium: 'PAID-SOCIAL' }, ['facebook', 'paid', 'meta_paid']],
  ['Alias meta + cpc', { source: 'meta', medium: 'cpc' }, ['facebook', 'paid', 'meta_paid']],
  ['Source as host: instagram.com + social', { source: 'instagram.com', medium: 'social' }, ['instagram', 'organic_social', 'instagram_organic']],
  ['YouTube organic social is other_social', { source: 'youtube', medium: 'social' }, ['youtube', 'organic_social', 'other_social']],
  ['DuckDuckGo referrer is other_search', { referrerHost: 'duckduckgo.com' }, ['other', 'organic_search', 'other_search']],
  // Review fixes: paid needs a known platform
  ['Unrecognized source with paid medium is unknown', { source: 'foo', medium: 'cpc' }, ['other', 'unknown', 'unknown', 'paid_signal_unrecognized_platform']],
  ['Unrecognized source + paid medium ignores a social referrer', { source: 'foo', medium: 'cpc', referrerHost: 'instagram.com' }, ['other', 'unknown', 'unknown']],
  ['Unrecognized source with mapped paid campaign is unknown', { source: 'foo', campaign: 'x', paidCampaigns: ['x'] }, ['other', 'unknown', 'unknown']],
  ['Paid WhatsApp (click-to-chat) is other_paid', { source: 'whatsapp', medium: 'cpc' }, ['whatsapp', 'paid', 'other_paid']],
  ['Paid alias google-ads', { source: 'google-ads', medium: 'cpc' }, ['google', 'paid', 'google_paid']],
  ['Paid alias Facebook Ads', { source: 'Facebook Ads', medium: 'cpc' }, ['facebook', 'paid', 'meta_paid']],
  ['Paid alias adwords', { source: 'adwords', medium: 'cpc' }, ['google', 'paid', 'google_paid']],
  ['Paid medium retargeting', { source: 'ig', medium: 'retargeting' }, ['instagram', 'paid', 'meta_paid']],
  ['Paid medium cpv', { source: 'youtube', medium: 'cpv' }, ['youtube', 'paid', 'other_paid']],
  // Review fixes: source/medium conflicts are unknown
  ['Conflict google + social', { source: 'google', medium: 'social' }, ['google', 'unknown', 'unknown', 'source_medium_conflict']],
  ['Conflict instagram + email', { source: 'instagram', medium: 'email' }, ['instagram', 'unknown', 'unknown', 'source_medium_conflict']],
  ['Conflict instagram + whatsapp medium', { source: 'instagram', medium: 'whatsapp' }, ['instagram', 'unknown', 'unknown']],
  ['Conflict email + social', { source: 'email', medium: 'social' }, ['email', 'unknown', 'unknown', 'source_medium_conflict']],
  ['Generic organic medium does not conflict with a social source', { source: 'facebook', medium: 'organic' }, ['facebook', 'organic_social', 'facebook_organic']],
  // Review fixes: hosts
  ['Google Docs is not search', { referrerHost: 'docs.google.com' }, ['other', 'referral', 'referral']],
  ['Google Drive is not search', { referrerHost: 'drive.google.com' }, ['other', 'referral', 'referral']],
  ['Google ccTLD is search', { referrerHost: 'www.google.com.ar' }, ['google', 'organic_search', 'google_organic']],
  ['Google lookalike host is referral', { referrerHost: 'google.com.evil.com' }, ['other', 'referral', 'referral']],
  ['Facebook lookalike host is referral', { referrerHost: 'notfacebook.com' }, ['other', 'referral', 'referral']],
  ['Gmail web is email, not search', { referrerHost: 'mail.google.com' }, ['email', 'email', 'email']],
  ['Protocol-relative referrer', { referrerHost: '//l.facebook.com/x' }, ['facebook', 'organic_social', 'facebook_organic']],
  ['Referrer with userinfo and port', { referrerHost: 'https://user:pw@l.facebook.com:443/x' }, ['facebook', 'organic_social', 'facebook_organic']],
  ['Instagram native app referrer', { referrerHost: 'android-app://com.instagram.android' }, ['instagram', 'organic_social', 'instagram_organic']],
  ['Gmail native app referrer', { referrerHost: 'android-app://com.google.android.gm' }, ['email', 'email', 'email']],
  ['Outlook.com web is email', { referrerHost: 'outlook.com' }, ['email', 'email', 'email']],
  // Review fixes: sources that are hosts/aliases of other platforms
  ['Source twitter.com is other_social', { source: 'twitter.com' }, ['other', 'organic_social', 'other_social']],
  ['Source linkedin is other_social', { source: 'linkedin' }, ['other', 'organic_social', 'other_social']],
  ['Source duckduckgo.com is other_search', { source: 'duckduckgo.com' }, ['other', 'organic_search', 'other_search']],
  ['Source linkedin with generic organic medium is social', { source: 'linkedin', medium: 'organic' }, ['other', 'organic_social', 'other_social']],
  ['Unrecognized source with organic medium is unknown', { source: 'foo', medium: 'organic' }, ['other', 'unknown', 'unknown']],
  ['Organic medium alone is organic search', { medium: 'organic' }, ['unknown', 'organic_search', 'other_search']],
  ['Source "direct" is direct', { source: 'direct', medium: 'none' }, ['unknown', 'direct', 'direct']],
  // Second review: ad aliases are paid even without a paid medium
  ['Ad alias facebook_ads without medium is paid', { source: 'facebook_ads' }, ['facebook', 'paid', 'meta_paid', 'paid_source_alias']],
  ['Ad alias ig_ads without medium is paid', { source: 'ig_ads' }, ['instagram', 'paid', 'meta_paid']],
  ['Ad alias google_ads without medium is paid', { source: 'google_ads' }, ['google', 'paid', 'google_paid']],
  ['Ad alias tiktok_ads without medium is paid', { source: 'tiktok_ads' }, ['tiktok', 'paid', 'other_paid']],
  ['Ad alias adwords with generic organic medium is paid', { source: 'adwords', medium: 'organic' }, ['google', 'paid', 'google_paid']],
  ['Ad alias with a same-family social medium stays paid (sloppy tagging)', { source: 'facebook_ads', medium: 'social' }, ['facebook', 'paid', 'meta_paid', 'paid_source_alias']],
  ['Ad alias with a different-family medium is a conflict', { source: 'facebook_ads', medium: 'email' }, ['facebook', 'unknown', 'unknown', 'source_medium_conflict']],
  // Second review: prefixed sources
  ['Prefixed source ig_stories + cpc is paid', { source: 'ig_stories', medium: 'cpc' }, ['instagram', 'paid', 'meta_paid']],
  ['Prefixed source "Instagram Stories" alone is organic', { source: 'Instagram Stories' }, ['instagram', 'organic_social', 'instagram_organic']],
  // Second review: paid mediums that imply a kind must agree with the source
  ['Conflict google + paid_social', { source: 'google', medium: 'paid_social' }, ['google', 'unknown', 'unknown', 'source_medium_conflict']],
  ['Conflict instagram + paid_search', { source: 'instagram', medium: 'paid_search' }, ['instagram', 'unknown', 'unknown', 'source_medium_conflict']],
  ['Mapped paid campaign cannot override a source/medium conflict', { source: 'google', medium: 'social', campaign: 'x', paidCampaigns: ['x'] }, ['google', 'unknown', 'unknown', 'source_medium_conflict']],
  // Second review: recognized-but-unlisted platforms are other_paid; bare "x" is not an alias
  ['LinkedIn + cpc is other_paid', { source: 'linkedin', medium: 'cpc' }, ['other', 'paid', 'other_paid']],
  ['Twitter + cpc is other_paid', { source: 'twitter', medium: 'cpc' }, ['other', 'paid', 'other_paid']],
  ['Bare "x" source is not an alias', { source: 'x' }, ['other', 'unknown', 'unknown', 'unrecognized_attribution']],
  // Second review: share buttons and pinned behavior
  ['WhatsApp share button (whatsapp + social)', { source: 'whatsapp', medium: 'social' }, ['whatsapp', 'messaging', 'whatsapp']],
  ['Instagram + referral medium stays organic social', { source: 'instagram', medium: 'referral' }, ['instagram', 'organic_social', 'instagram_organic']],
  // Second review: hosts
  ['google.org is not search', { referrerHost: 'google.org' }, ['other', 'referral', 'referral']],
  ['google.dev is not search', { referrerHost: 'google.dev' }, ['other', 'referral', 'referral']],
  ['google.cn is search', { referrerHost: 'google.cn' }, ['google', 'organic_search', 'google_organic']],
  ['FQDN with trailing dot', { referrerHost: 'https://www.instagram.com./' }, ['instagram', 'organic_social', 'instagram_organic']],
  ['WhatsApp Business native app', { referrerHost: 'android-app://com.whatsapp.w4b' }, ['whatsapp', 'messaging', 'whatsapp']],
  ['"not set" placeholders are direct', { source: 'not set', medium: 'not set' }, ['unknown', 'direct', 'direct']],
];

for (const [name, input, expected] of CASES) {
  test(`classifies: ${name}`, () => {
    const result = classifyAcquisition(input);
    assert.deepEqual([result.sourcePlatform, result.acquisitionType, result.channelGroup], expected.slice(0, 3));
    if (expected[3]) assert.equal(result.reason, expected[3]);
    assert.equal(result.classifierVersion, CLASSIFIER_VERSION);
    assert.ok(result.reason.length > 0);
  });
}

test('social source without a paid medium is never classified as paid', () => {
  for (const source of ['instagram', 'facebook', 'google', 'ig', 'fb']) {
    assert.notEqual(classifyAcquisition({ source }).acquisitionType, 'paid', source);
  }
});

test('social source without medium is organic social with an explicit reason', () => {
  const result = classifyAcquisition({ source: 'instagram' });
  assert.equal(result.channelGroup, 'instagram_organic');
  assert.equal(result.reason, 'social_source_without_paid_medium');
});

test('campaign explicitly mapped as paid upgrades a known platform to paid', () => {
  const input: ClassifierInput = { source: 'facebook', campaign: 'Promo_Black', paidCampaigns: ['promo_black'] };
  const result = classifyAcquisition(input);
  assert.equal(result.channelGroup, 'meta_paid');
  assert.equal(result.reason, 'paid_campaign_mapped');
});

test('campaign not in the paid list does not upgrade to paid', () => {
  const result = classifyAcquisition({ source: 'facebook', campaign: 'otra', paidCampaigns: ['promo_black'] });
  assert.equal(result.acquisitionType, 'organic_social');
});

test('paid medium wins over a social referrer', () => {
  const result = classifyAcquisition({ source: 'instagram', medium: 'cpc', referrerHost: 'l.instagram.com' });
  assert.deepEqual([result.acquisitionType, result.channelGroup, result.reason], ['paid', 'meta_paid', 'paid_medium']);
});

test('mapped paid campaign with an email source reports a campaign reason, not a medium one', () => {
  const result = classifyAcquisition({ source: 'email', campaign: 'x', paidCampaigns: ['x'] });
  assert.equal(result.reason, 'paid_signal_contradicts_email_source');
});

test('empty or blank paidCampaigns entries never match a missing campaign', () => {
  assert.equal(classifyAcquisition({ source: 'facebook', paidCampaigns: [''] }).acquisitionType, 'organic_social');
  assert.equal(classifyAcquisition({ source: 'facebook', campaign: ' ', paidCampaigns: [' '] }).acquisitionType, 'organic_social');
});
