/** Credentials of the single emitter (Modista), read from the environment. */
export interface ArcaConfig {
  /** Emitter CUIT, digits only. */
  cuit: string;
  /** Digital certificate issued by ARCA, PEM. */
  certificatePem: string;
  /** Private key matching the certificate, PEM. */
  privateKeyPem: string;
  /** Point of sale of type "RECE para aplicación y web services". */
  pointOfSale: number;
  /** Homologation (testing) or production endpoints. */
  environment: 'homologation' | 'production';
}

/** WSAA access ticket for the `wsfe` service. */
export interface ArcaTicket {
  token: string;
  sign: string;
  expiresAt: Date;
}

/** Persistence port for the WSAA ticket (ARCA refuses a new one while the previous is valid). */
export interface ArcaTicketStore {
  load: () => Promise<ArcaTicket | null>;
  save: (ticket: ArcaTicket) => Promise<void>;
  /** Forget the stored ticket (ARCA said it is invalid) so the next call logs in again. */
  clear?: () => Promise<void>;
}

/** One SOAP call; returns the raw response body. Injected so tests never hit the network. */
export type ArcaTransport = (request: ArcaHttpRequest) => Promise<string>;

export interface ArcaHttpRequest {
  url: string;
  soapAction: string;
  body: string;
}

/** Factura C to a final consumer, for a service paid in full on `issueDate`. */
export interface CaeRequest {
  /** Invoice number to request (last authorized + 1). */
  number: number;
  total: number;
  issueDate: Date;
}

export interface CaeResult {
  cae: string;
  /** CAE expiration as YYYY-MM-DD. */
  caeExpiresAt: string;
  number: number;
}

/** An authorized invoice as ARCA has it, used to reconcile after a lost response. */
export interface ArcaInvoiceRecord extends CaeResult {
  total: number;
  /** Issue date as YYYY-MM-DD. */
  issueDate: string;
}

/** Emitter data printed on the invoice; copied into each invoice so later edits never change old ones. */
export interface InvoiceEmitter {
  legalName: string;
  cuit: string;
  address: string;
  ivaCondition: string;
}

export interface IssueInvoiceInput {
  /** Inscription (ObjectId as string) the payment belongs to. */
  inscriptionId: string;
  /** Amount actually collected. */
  total: number;
  /** Line description, the course title. */
  description: string;
  receiverName: string;
  receiverEmail: string;
  mpPaymentId?: string;
}

export interface IssueInvoiceDeps {
  client: ArcaClientPort;
  config: Pick<ArcaConfig, 'cuit' | 'pointOfSale' | 'environment'>;
  emitter: InvoiceEmitter;
  /** Injectable clock for tests. */
  now?: () => Date;
}

/** The ARCA operations issuing needs; `ArcaClient` satisfies it. */
export interface ArcaClientPort {
  lastAuthorized: () => Promise<number>;
  requestCae: (request: CaeRequest) => Promise<CaeResult>;
  consult: (number: number) => Promise<ArcaInvoiceRecord | null>;
}

export interface IssueInvoiceResult {
  invoiceId: string;
  status: 'pending' | 'authorized' | 'failed';
  /** True only when this very call obtained the CAE (so the caller sends the email once). */
  issued: boolean;
}

/** Whether invoicing may run in this deployment; disabled is a normal state, not an error. */
export type InvoicingSettings =
  | { enabled: true; config: ArcaConfig; emitter: InvoiceEmitter }
  | { enabled: false; reason: string };

/** What the payment flow knows when an inscription gets fully paid. */
export interface PaymentInvoiceInput {
  inscriptionId: string;
  total: number;
  courseTitle: string;
  /** Receiver full name (final consumer: no document). */
  name: string;
  email: string;
  mpPaymentId: string;
}

/** Public page of an authorized invoice. */
export interface InvoiceLink {
  url: string;
}

export interface IssueInvoiceForPaymentOptions {
  settings?: InvoicingSettings;
  client?: ArcaClientPort;
  /** How long the payment flow waits for ARCA before leaving the invoice to the retry job. */
  timeoutMs?: number;
}

export interface FiscalQrInput {
  cuit: string;
  pointOfSale: number;
  number: number;
  total: number;
  issueDate: Date;
  cae: string;
}
