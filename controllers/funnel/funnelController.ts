import { Request, Response } from 'express';
import FunnelEvent from '../../models/FunnelEvent.js';
import { logError } from '../../services/logger.js';
import { fireMetaEvent, buildEventId } from '../../services/meta-capi-helpers/index.js';
import Course from '../../models/Course.js';

export const trackFunnelStep = async (req: Request, res: Response) => {
  const { uuid, stepName, courseTitle, fbc, fbp } = req.body;
  const clientIpAddress = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();
  const clientUserAgent = req.headers['user-agent'] || '';

  try {
    const course = await Course.findOne({ title: courseTitle });
    
    // Solo disparamos CAPI para ViewContent aquí (o si quisiéramos otro)
    if (stepName === 'view_content' && course) {
      await fireMetaEvent({
        eventName: 'ViewContent',
        eventId: buildEventId('view_content', `${uuid}_${Date.now()}`),
        value: course.price,
        currency: 'ARS',
        contentName: course.title,
        ...(course.uuid ? { contentIds: [course.uuid] } : {}),
        contentType: 'product',
        fbc: fbc,
        fbp: fbp,
        clientIpAddress: clientIpAddress,
        clientUserAgent: clientUserAgent,
        eventSourceUrl: req.headers.referer || 'https://modista-app.com',
      });
    }

    // Registrar en BD propia para analytics
    await FunnelEvent.create({
      uuid,
      stepName,
      courseTitle,
      metaFbc: fbc,
      metaFbp: fbp,
      clientIpAddress,
      clientUserAgent
    });

    res.status(200).json({ success: true });
  } catch (err) {
    logError('trackFunnelStep', err instanceof Error ? err : new Error(String(err)));
    res.status(500).json({ success: false });
  }
};
