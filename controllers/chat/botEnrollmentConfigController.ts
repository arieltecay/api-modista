import { Request, Response } from 'express';
import { getEnrollmentConfig as loadEnrollmentConfig, saveEnrollmentConfig as persistEnrollmentConfig } from '../../services/BotEnrollment/config.js';
import { DEFAULT_ENROLLMENT_TEMPLATES } from '../../services/BotEnrollment/templates.js';
import { enrollmentConfigSchema } from './botEnrollmentConfigSchema.js';

/** Interruptor de WhatsApp, textos activos y textos por defecto (para restaurar). */
export const getEnrollmentConfig = async (_req: Request, res: Response) => {
  const config = await loadEnrollmentConfig();
  res.json({ ...config, defaults: DEFAULT_ENROLLMENT_TEMPLATES });
};

export const saveEnrollmentConfig = async (req: Request, res: Response) => {
  const parsed = enrollmentConfigSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Configuración inválida', issues: parsed.error.issues.map(issue => issue.message) });
  await persistEnrollmentConfig(parsed.data);
  const config = await loadEnrollmentConfig();
  res.json({ ...config, defaults: DEFAULT_ENROLLMENT_TEMPLATES });
};
