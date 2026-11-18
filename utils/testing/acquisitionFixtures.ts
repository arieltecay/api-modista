import { randomUUID } from 'node:crypto';
import AcquisitionEvent from '../../models/AcquisitionEvent/index.js';
import AcquisitionSignalAttempt from '../../models/AcquisitionSignalAttempt/index.js';
import AcquisitionVisit from '../../models/AcquisitionVisit/index.js';
import Inscription from '../../models/Inscription.js';

export interface VisitFixture {
  visitorId: string;
  at: string;
  channel: string;
  visitId?: string;
  platform?: string;
  campaign?: string;
  source?: string;
  medium?: string;
  landing?: string;
  device?: string;
  reason?: string;
  acquisitionType?: string;
  hasFbc?: boolean;
  /** Server-side "last touched" time, which the live panel reads. */
  updatedAt?: string;
}

export const visit = async (fixture: VisitFixture): Promise<string> => {
  const visitId = fixture.visitId ?? randomUUID();
  await AcquisitionVisit.create({
    visitId,
    visitorId: fixture.visitorId,
    startedAt: new Date(fixture.at),
    lastActivityAt: new Date(fixture.at),
    entryPath: '/lp',
    landingSlug: fixture.landing,
    device: fixture.device ?? 'desktop',
    hasFbc: fixture.hasFbc ?? false,
    rawAttribution: { campaign: fixture.campaign, source: fixture.source, medium: fixture.medium },
    classification: {
      sourcePlatform: fixture.platform ?? 'unknown',
      acquisitionType: fixture.acquisitionType ?? 'x',
      channelGroup: fixture.channel,
      reason: fixture.reason ?? 'paid_medium',
      classifierVersion: 1,
    },
    consentVersion: 'v1',
  });
  if (fixture.updatedAt) {
    await AcquisitionVisit.collection.updateOne({ visitId }, { $set: { updatedAt: new Date(fixture.updatedAt) } });
  }
  return visitId;
};

export interface InscriptionFixture {
  createdAt: string;
  price: number;
  status: 'pending' | 'paid' | 'partial';
  payments?: Array<[amount: number, at: string]>;
  paymentDate?: string;
  depositAmount?: number;
  depositDate?: string;
  consent?: boolean;
}

let sequence = 0;
export const inscription = async (fixture: InscriptionFixture): Promise<string> => {
  sequence += 1;
  const doc = await Inscription.create({
    nombre: 'Nombre',
    apellido: 'Apellido',
    email: `person${sequence}@example.com`,
    celular: '3815550000',
    courseId: 'course-1',
    courseTitle: 'Curso',
    coursePrice: fixture.price,
    paymentStatus: fixture.status,
    fechaInscripcion: new Date(fixture.createdAt),
    paymentDate: fixture.paymentDate ? new Date(fixture.paymentDate) : undefined,
    depositAmount: fixture.depositAmount,
    depositDate: fixture.depositDate ? new Date(fixture.depositDate) : undefined,
    metaMarketingConsent: fixture.consent ?? false,
    paymentHistory: (fixture.payments ?? []).map(([amount, at]) => ({ amount, date: new Date(at) })),
  });
  return doc._id.toHexString();
};

export interface EventFixture {
  visitId: string;
  visitorId: string;
  name: string;
  at: string;
  eventId?: string;
  receivedAt?: string;
  courseId?: string;
  inscriptionId?: string;
  path?: string;
  source?: 'browser' | 'server' | 'backfill';
}

export const acquisitionEvent = (fixture: EventFixture) =>
  AcquisitionEvent.create({
    eventId: fixture.eventId ?? randomUUID(),
    visitId: fixture.visitId,
    visitorId: fixture.visitorId,
    name: fixture.name,
    occurredAt: new Date(fixture.at),
    receivedAt: fixture.receivedAt ? new Date(fixture.receivedAt) : new Date(fixture.at),
    courseId: fixture.courseId,
    inscriptionId: fixture.inscriptionId,
    path: fixture.path,
    source: fixture.source ?? 'browser',
  });

export const lead = (visitId: string, visitorId: string, inscriptionId: string, at: string) =>
  acquisitionEvent({ visitId, visitorId, name: 'lead', at, inscriptionId, eventId: `lead_${inscriptionId}`, source: 'server' });

export const capiAttempt = async (fixture: { eventId: string; status: string; at: string; updatedAt?: string }) => {
  await AcquisitionSignalAttempt.create({
    eventId: fixture.eventId, channel: 'server_capi', status: fixture.status, occurredAt: new Date(fixture.at),
  });
  if (fixture.updatedAt) {
    await AcquisitionSignalAttempt.collection.updateOne({ eventId: fixture.eventId }, { $set: { updatedAt: new Date(fixture.updatedAt) } });
  }
};
