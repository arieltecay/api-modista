import type { Request, Response } from 'express';
import { recordMetaMarketingConsent } from '../../services/privacy/marketingConsent.js';
import { META_MARKETING_CONSENT_VERSION } from '../../utils/metaMarketingConsent.js';

interface MarketingConsentBody {
  sessionId?: string;
  marketingConsent?: boolean;
  policyVersion?: string;
}

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const saveMarketingConsent = async (
  req: Request<{}, {}, MarketingConsentBody>,
  res: Response,
): Promise<void> => {
  const { sessionId, marketingConsent, policyVersion } = req.body ?? {};

  if (
    typeof sessionId !== 'string' ||
    !SESSION_ID_PATTERN.test(sessionId) ||
    typeof marketingConsent !== 'boolean' ||
    policyVersion !== META_MARKETING_CONSENT_VERSION
  ) {
    res.status(400).json({ success: false, message: 'La elección de privacidad no es válida.' });
    return;
  }

  await recordMetaMarketingConsent(sessionId, marketingConsent);
  res.status(200).json({ success: true, policyVersion: META_MARKETING_CONSENT_VERSION });
};
