/** ARCA could not be reached or answered something unusable: safe to retry later. */
export class ArcaUnavailableError extends Error {
  /** ARCA rejected the access ticket itself: the stored one must be dropped. */
  readonly invalidatesTicket: boolean;

  constructor(message: string, invalidatesTicket = false) {
    super(message);
    this.name = 'ArcaUnavailableError';
    this.invalidatesTicket = invalidatesTicket;
  }
}

/** ARCA answered and refused the request: retrying the same data will not help. */
export class ArcaRejectedError extends Error {
  readonly codes: string[];

  constructor(message: string, codes: string[]) {
    super(message);
    this.name = 'ArcaRejectedError';
    this.codes = codes;
  }
}
