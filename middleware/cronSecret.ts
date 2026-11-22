import type { NextFunction, Request, Response } from 'express';

/**
 * Protege un endpoint de cron: Vercel envía `Authorization: Bearer <CRON_SECRET>`.
 * Sin CRON_SECRET configurado el endpoint no opera (503), para no dejarlo abierto por omisión.
 */
export const requireCronSecret = (req: Request, res: Response, next: NextFunction): void => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    res.status(503).json({ success: false, message: 'CRON_SECRET no configurado' });
    return;
  }
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    res.status(401).json({ success: false, message: 'No autorizado' });
    return;
  }
  next();
};
