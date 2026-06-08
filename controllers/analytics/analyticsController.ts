import { Request, Response } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import Session from '../../models/Session.js';
import Inscription from '../../models/Inscription.js';

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos CSV'));
    }
  },
});

function normalizeGa4Value(value: string): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (['(direct)', '(none)', '(not set)', '(referral)', '(organic)'].includes(v)) return undefined;
  return v || undefined;
}

function parseGa4Date(dateStr: string): Date {
  const year = parseInt(dateStr.substring(0, 4), 10);
  const month = parseInt(dateStr.substring(4, 6), 10) - 1;
  const day = parseInt(dateStr.substring(6, 8), 10);
  const hour = parseInt(dateStr.substring(8, 10), 10);
  const minute = Math.floor(Math.random() * 60);
  return new Date(Date.UTC(year, month, day, hour, minute));
}

export const importCsv = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Archivo CSV requerido' });
      return;
    }

    const csvContent = req.file.buffer.toString('utf-8');
    const lines = csvContent.split('\n').filter(l => l.trim() && !l.startsWith('#'));

    if (lines.length < 2) {
      res.status(400).json({ error: 'CSV vacío o sin datos' });
      return;
    }

    const records = parse(lines.join('\n'), {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
    }) as Record<string, string>[];

    const sessions: any[] = [];
    let totalSessions = 0;

    for (const record of records) {
      const dateStr = record['Fecha y hora (AAAAMMDDHH)']?.trim();
      const source = record['Fuente de la sesión']?.trim();
      const medium = record['Medio de la sesión']?.trim();
      const campaign = record['Campaña de la sesión']?.trim();
      const count = parseInt(record['Sesiones']?.trim(), 10) || 1;

      if (!dateStr) continue;

      const createdAt = parseGa4Date(dateStr);
      const utmSource = normalizeGa4Value(source);
      const utmMedium = normalizeGa4Value(medium);
      const utmCampaign = normalizeGa4Value(campaign);

      for (let i = 0; i < count; i++) {
        sessions.push({
          sessionId: crypto.randomUUID(),
          utmSource,
          utmMedium,
          utmCampaign,
          landingPage: '/',
          createdAt: new Date(createdAt.getTime() + Math.random() * 60000),
          lastActivityAt: createdAt,
        });
      }

      totalSessions += count;
    }

    if (sessions.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < sessions.length; i += batchSize) {
        await Session.insertMany(sessions.slice(i, i + batchSize), { ordered: false });
      }
    }

    res.json({
      success: true,
      importedSessions: totalSessions,
      message: `Se importaron ${totalSessions} sesiones correctamente`,
    });
  } catch (error: any) {
    console.error('[Analytics] Error importing CSV:', error);
    res.status(500).json({ error: error.message });
  }
};

export { csvUpload };

export const trackSession = async (req: Request, res: Response) => {
  try {
    const {
      sessionId, utmSource, utmMedium, utmCampaign,
      utmTerm, utmContent, referrer, device, landingPage,
    } = req.body;

    if (!sessionId || !landingPage) {
      res.status(400).json({ error: 'sessionId y landingPage son requeridos' });
      return;
    }

    const existing = await Session.findOne({ sessionId });

    if (existing) {
      await Session.updateOne(
        { sessionId },
        { $set: { lastActivityAt: new Date() } }
      );
    } else {
      await Session.create({
        sessionId,
        utmSource,
        utmMedium,
        utmCampaign,
        utmTerm,
        utmContent,
        referrer,
        device,
        landingPage,
        userAgent: req.headers['user-agent'],
        ip: req.ip,
      });
    }

    res.status(existing ? 200 : 201).json({ ok: true });
  } catch (error: any) {
    console.error('[Analytics] Error tracking session:', error);
    res.status(500).json({ error: error.message });
  }
};

function classifyChannel(session: any): string {
  const medium = (session.utmMedium || '').toLowerCase().trim();
  const source = (session.utmSource || '').toLowerCase().trim();
  const hasUtm = !!session.utmMedium || !!session.utmSource;
  const hasReferrer = !!session.referrer;

  // Medios que indican trfico pago (CPC, Paid Social, etc.)
  const paidMediums = ['cpc', 'ppc', 'paid', 'paid_social', 'paidsocial', 'paid-social'];
  // Fuentes que son inherentemente pagas (Meta, Google, TikTok, etc.)
  const paidSources = [
    'meta_ads', 'facebook_ads', 'instagram_ads', 'google_ads',
    'facebook', 'instagram', 'tiktok', 'google'
  ];

  if (paidMediums.some(p => medium.includes(p))) return 'paid';
  if (paidSources.some(s => source.includes(s))) return 'paid';
  if (medium === 'social') return 'social_organic';
  if (['organic', 'search'].includes(medium)) return 'organic_search';
  if (medium === 'email') return 'email';
  if (!hasUtm && hasReferrer) return 'referral';
  if (!hasUtm && !hasReferrer) return 'direct';
  return 'other';
}

export const getTrafficStats = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;

    const query: any = {};
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate as string);
      if (endDate) {
        const end = new Date(endDate as string);
        end.setUTCHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    const sessions = await Session.find(query)
      .select('sessionId utmSource utmMedium utmCampaign referrer createdAt')
      .lean();

    const channels: Record<string, number> = {
      paid: 0, organic_search: 0, social_organic: 0,
      direct: 0, email: 0, referral: 0, other: 0,
    };

    const dailyMap: Record<string, { date: string; organic: number; paid: number; direct: number }> = {};
    const campaignVisits: Record<string, number> = {};
    const sessionToCampaign: Record<string, string> = {};

    for (const session of sessions) {
      const channel = classifyChannel(session);
      channels[channel] = (channels[channel] || 0) + 1;

      const dateKey = new Date(session.createdAt).toISOString().split('T')[0];
      if (!dailyMap[dateKey]) {
        dailyMap[dateKey] = { date: dateKey, organic: 0, paid: 0, direct: 0 };
      }

      if (channel === 'paid') dailyMap[dateKey].paid++;
      else if (channel === 'direct') dailyMap[dateKey].direct++;
      else dailyMap[dateKey].organic++;

      if (session.utmCampaign) {
        campaignVisits[session.utmCampaign] = (campaignVisits[session.utmCampaign] || 0) + 1;
        sessionToCampaign[session.sessionId] = session.utmCampaign;
      }
    }

    // Vincular inscripciones con campañas (Contamos TODOS los registros como Leads)
    const sessionIds = sessions.map(s => s.sessionId);
    const leadsInscriptions = await Inscription.find({
      sessionId: { $in: sessionIds }
    }).select('sessionId').lean();

    const campaignLeads: Record<string, number> = {};
    for (const ins of leadsInscriptions) {
      if (ins.sessionId) {
        const campaign = sessionToCampaign[ins.sessionId];
        if (campaign) {
          campaignLeads[campaign] = (campaignLeads[campaign] || 0) + 1;
        }
      }
    }

    const topCampaigns = Object.entries(campaignVisits)
      .map(([campaign, visits]) => ({
        campaign,
        visits,
        leads: campaignLeads[campaign] || 0,
      }))
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 10);

    const paid = channels.paid;
    const direct = channels.direct;
    const organic = channels.organic_search + channels.social_organic +
      channels.email + channels.referral + channels.other;

    res.json({
      totalSessions: sessions.length,
      paid,
      organic,
      direct,
      socialOrganic: channels.social_organic,
      referral: channels.referral,
      email: channels.email,
      topCampaigns,
      dailyBreakdown: Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)),
      lastUpdated: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[Analytics] Error getting traffic stats:', error);
    res.status(500).json({ error: error.message });
  }
};
