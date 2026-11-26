interface IssueStatus {
  status: 'pending' | 'authorized' | 'failed';
  issued: boolean;
}

/** Result of an admin retry, as the controller needs it. */
export type RetryOutcome =
  | { kind: 'done'; result: IssueStatus & { invoiceId: string } }
  | { kind: 'not_found' }
  | { kind: 'disabled'; reason: string };

/** Result of issuing or retrying the credit note of an invoice. */
export type CreditNoteActionOutcome =
  | { kind: 'done'; result: IssueStatus }
  | { kind: 'not_found' }
  | { kind: 'not_allowed'; reason: string }
  | { kind: 'disabled'; reason: string };

export interface CreditNoteRequest {
  invoiceId: string;
  reason: string;
  /** Admin user id. */
  createdBy: string;
}

/** What the controller needs from the invoicing service; injected so tests never reach ARCA or SMTP. */
export interface InvoicesServices {
  retry: (invoiceId: string) => Promise<RetryOutcome>;
  /** True when the email was sent. */
  resend: (invoiceId: string) => Promise<boolean>;
  issueCreditNote: (request: CreditNoteRequest) => Promise<CreditNoteActionOutcome>;
  retryCreditNote: (invoiceId: string) => Promise<CreditNoteActionOutcome>;
  /** True when the email was sent. */
  resendCreditNote: (invoiceId: string) => Promise<boolean>;
}
