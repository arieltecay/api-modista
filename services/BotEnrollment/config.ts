import BotEnrollmentConfig from '../../models/BotEnrollmentConfig/index.js';
import { DEFAULT_ENROLLMENT_TEMPLATES } from './templates.js';
import type { EnrollmentConfig, EnrollmentTemplateKey, EnrollmentTemplates } from './types.js';

export interface EnrollmentConfigInput {
  whatsappLookupEnabled?: boolean;
  templates?: Partial<EnrollmentTemplates>;
}

const templateKeys = Object.keys(DEFAULT_ENROLLMENT_TEMPLATES) as EnrollmentTemplateKey[];

export const getEnrollmentConfig = async (): Promise<EnrollmentConfig> => {
  const stored = await BotEnrollmentConfig.findOne({ key: 'default' }).lean();
  const templates = { ...DEFAULT_ENROLLMENT_TEMPLATES };
  for (const key of templateKeys) {
    const value = stored?.templates?.[key];
    if (typeof value === 'string') templates[key] = value;
  }
  return { whatsappLookupEnabled: stored?.whatsappLookupEnabled ?? false, templates };
};

/** `templates` reemplaza todas las personalizaciones: lo que se omite vuelve al texto por defecto. */
export const saveEnrollmentConfig = async (input: EnrollmentConfigInput): Promise<void> => {
  const changes: Record<string, unknown> = {};
  if (input.whatsappLookupEnabled !== undefined) changes.whatsappLookupEnabled = input.whatsappLookupEnabled;
  if (input.templates !== undefined) changes.templates = input.templates;
  await BotEnrollmentConfig.updateOne({ key: 'default' }, { $set: changes, $setOnInsert: { key: 'default' } }, { upsert: true });
};
