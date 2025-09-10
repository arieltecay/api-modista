import winston from 'winston';

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
  ]
});

export const logError = (controllerName: string, error: Error) => {
    logger.error({
        controller: controllerName,
        message: error.message,
        stack: error.stack,
    });
};
