import { XMLParser } from 'fast-xml-parser';
import { ArcaUnavailableError } from './errors.js';

type XmlNode = Record<string, unknown>;

const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false, trimValues: true });

export const soapEnvelope = (inner: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${inner}</soap:Body></soap:Envelope>`;

/** Narrows an unknown XML value to a node, or an empty one when it is missing or a plain string. */
export const asNode = (value: unknown): XmlNode => (value && typeof value === 'object' ? (value as XmlNode) : {});

/** A repeated XML child comes as an array and a single one as an object: always a list. */
export const asList = (value: unknown): XmlNode[] => (Array.isArray(value) ? value.map(asNode) : value ? [asNode(value)] : []);

export const text = (value: unknown): string | undefined =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;

export const parseXml = (xml: string): XmlNode => asNode(parser.parse(xml));

/** Body of a SOAP response; a SOAP Fault means ARCA could not process the call at all. */
export const soapBody = (xml: string): XmlNode => {
  const body = asNode(asNode(parseXml(xml).Envelope).Body);
  const fault = asNode(body.Fault);
  if (Object.keys(fault).length > 0) {
    throw new ArcaUnavailableError(`ARCA SOAP fault: ${text(fault.faultstring) ?? 'sin detalle'}`);
  }
  return body;
};
