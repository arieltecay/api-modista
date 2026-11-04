import MetaMarketingConsent from '../../models/MetaMarketingConsent.js';
import MetaEventDlq from '../../models/MetaEventDlq.js';
import Inscription from '../../models/Inscription.js';
import Session from '../../models/Session.js';
import FunnelEvent from '../../models/FunnelEvent.js';
import {
  isMetaMarketingConsentCurrent,
  META_MARKETING_CONSENT_VERSION,
} from '../../utils/metaMarketingConsent.js';

export const hasCurrentMetaMarketingConsent = async (
  sessionId: string | undefined,
  policyVersion: string | undefined,
): Promise<boolean> => {
  if (!sessionId || policyVersion !== META_MARKETING_CONSENT_VERSION) return false;

  const consent = await MetaMarketingConsent.findOne({
    sessionId,
    marketingConsent: true,
    policyVersion: META_MARKETING_CONSENT_VERSION,
  }).select('consentAt');

  return consent !== null && isMetaMarketingConsentCurrent(consent.consentAt);
};

export const recordMetaMarketingConsent = async (
  sessionId: string,
  marketingConsent: boolean,
): Promise<void> => {
  await MetaMarketingConsent.findOneAndUpdate(
    { sessionId },
    {
      $set: {
        marketingConsent,
        policyVersion: META_MARKETING_CONSENT_VERSION,
        consentAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  if (!marketingConsent) {
    await Promise.all([
      Inscription.updateMany(
        { sessionId },
        {
          $set: {
            metaMarketingConsent: false,
            metaMarketingConsentAt: new Date(),
            metaMarketingConsentVersion: META_MARKETING_CONSENT_VERSION,
          },
          $unset: {
            sessionId: '',
            metaFbc: '',
            metaFbp: '',
            clientIpAddress: '',
            clientUserAgent: '',
            eventSourceUrl: '',
          },
        },
      ),
      Session.deleteMany({ sessionId }),
      FunnelEvent.deleteMany({ sessionId }),
      MetaEventDlq.updateMany(
        { status: 'pending', 'payload.externalId': sessionId },
        {
          $set: {
            status: 'exhausted',
            lastError: 'Evento descartado: consentimiento publicitario revocado',
          },
          $unset: { payload: '' },
        },
      ),
      MetaEventDlq.updateMany(
        { status: { $in: ['sent', 'failed', 'exhausted'] }, 'payload.externalId': sessionId },
        { $unset: { payload: '' } },
      ),
    ]);
  }
};
