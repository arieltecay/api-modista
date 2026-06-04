import winston from 'winston';
import { WinstonTransport as AxiomTransport } from '@axiomhq/winston';

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.errors({ stack: true }), // Captura automáticamente el stack trace si se pasa un objeto Error
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'api-modista' },
  transports: [
    new winston.transports.Console(),
    new AxiomTransport({
      dataset: process.env.AXIOM_DATASET || 'api-modista',
      token: process.env.AXIOM_TOKEN,
    }),
  ]
});

export const logError = (controllerName: string, error: Error, additionalInfo?: any) => {
    logger.error({
        controller: controllerName,
        message: error.message,
        stack: error.stack,
        ...additionalInfo
    });
};
