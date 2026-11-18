export type AcquisitionVisitDevice = 'mobile' | 'desktop' | 'tablet' | 'unknown';

export interface AcquisitionVisitClassification {
  sourcePlatform: string;
  acquisitionType: string;
  channelGroup: string;
  reason: string;
  classifierVersion: number;
}

export interface AcquisitionVisitRawAttribution {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
}

export interface AcquisitionVisitPersistence {
  visitId: string;
  visitorId: string;
  startedAt: Date;
  lastActivityAt: Date;
  entryPath: string;
  rawAttribution: AcquisitionVisitRawAttribution;
  classification: AcquisitionVisitClassification;
  device: AcquisitionVisitDevice;
  hasFbc: boolean;
  hasFbp: boolean;
  consentVersion: string;
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
  landingSlug?: string;
  referrerHost?: string;
}
