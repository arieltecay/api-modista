export interface BotEnrollmentConfigDocument {
  key: 'default';
  whatsappLookupEnabled: boolean;
  /** Solo las plantillas que el admin personalizó; el resto usa el texto por defecto. */
  templates: Partial<Record<string, string>>;
}
