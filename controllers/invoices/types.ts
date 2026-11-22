/** Result of an admin retry, as the controller needs it. */
export type RetryOutcome =
  | { kind: 'done'; result: { invoiceId: string; status: 'pending' | 'authorized' | 'failed'; issued: boolean } }
  | { kind: 'not_found' }
  | { kind: 'disabled'; reason: string };

/** What the controller needs from the invoicing service; injected so tests never reach ARCA or SMTP. */
export interface InvoicesServices {
  retry: (invoiceId: string) => Promise<RetryOutcome>;
  /** True when the email was sent. */
  resend: (invoiceId: string) => Promise<boolean>;
}
