import winston from 'winston';
import { WinstonTransport as AxiomTransport } from '@axiomhq/winston';

const transports: winston.transport[] = [new winston.transports.Console()];

if (process.env.AXIOM_TOKEN) {
  transports.push(
    new AxiomTransport({
      dataset: process.env.AXIOM_DATASET || 'api-modista',
      token: process.env.AXIOM_TOKEN,
    })
  );
}

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'api-modista' },
  transports,
});

export const logError = (controllerName: string, error: Error, additionalInfo?: any) => {
    logger.error({
        controller: controllerName,
        message: error.message,
        stack: error.stack,
        ...additionalInfo
    });
};
