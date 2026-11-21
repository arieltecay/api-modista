export type EnrollmentTemplateKey =
  | 'header'
  | 'paid'
  | 'partial'
  | 'pending'
  | 'review'
  | 'footer'
  | 'notFound'
  | 'askContact'
  | 'rateLimited';

export type EnrollmentTemplates = Record<EnrollmentTemplateKey, string>;

export interface EnrollmentConfig {
  whatsappLookupEnabled: boolean;
  templates: EnrollmentTemplates;
}
