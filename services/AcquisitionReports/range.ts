export const DEFAULT_TIMEZONE = 'America/Argentina/Tucuman';
export const MAX_RANGE_DAYS = 92;

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_YEAR = 1900; // Date.UTC maps years 0-99 to 1900-1999
const MAX_YEAR = 2100;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export class ReportRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportRangeError';
  }
}

export interface ReportRange {
  /** Inclusive start, UTC instant of the first local midnight. */
  from: Date;
  /** Exclusive end, UTC instant of the local midnight after the last day. */
  toExclusive: Date;
  timezone: string;
}

/** Midnight of a `YYYY-MM-DD` day expressed as if it were UTC; rejects impossible dates. */
const parseDay = (value: string): number => {
  const match = DATE_PATTERN.exec(value);
  const time = match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : Number.NaN;
  const date = new Date(time);
  const sensibleYear = match !== null && Number(match[1]) >= MIN_YEAR && Number(match[1]) <= MAX_YEAR;
  const roundTrips = sensibleYear && match !== null && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
  if (!roundTrips) throw new ReportRangeError('Fecha inválida: se espera YYYY-MM-DD');
  return time;
};

const assertTimezone = (timezone: string): void => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new ReportRangeError('Zona horaria inválida');
  }
};

/** Offset of `timezone` from UTC at `instant`, in ms (positive east of UTC). */
const offsetAt = (instant: number, timezone: string): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const field = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const localAsUtc = Date.UTC(field('year'), field('month') - 1, field('day'), field('hour'), field('minute'), field('second'));
  return localAsUtc - Math.floor(instant / 1000) * 1000;
};

/** UTC instant of local midnight for `dayAsUtc`; the second pass settles days where DST shifts the offset. */
const localMidnightToUtc = (dayAsUtc: number, timezone: string): number => {
  const firstGuess = dayAsUtc - offsetAt(dayAsUtc, timezone);
  return dayAsUtc - offsetAt(firstGuess, timezone);
};

/**
 * Converts inclusive local calendar days into the `[from, toExclusive)` UTC range every report
 * query uses. This is the only place that turns days into instants.
 */
export const resolveRange = ({ from, to, timezone }: { from: string; to: string; timezone: string }): ReportRange => {
  assertTimezone(timezone);
  const first = parseDay(from);
  const last = parseDay(to);
  if (first > last) throw new ReportRangeError('"from" no puede ser posterior a "to"');
  if ((last - first) / DAY_MS + 1 > MAX_RANGE_DAYS) {
    throw new ReportRangeError(`El rango máximo es de ${MAX_RANGE_DAYS} días`);
  }

  return {
    from: new Date(localMidnightToUtc(first, timezone)),
    toExclusive: new Date(localMidnightToUtc(last + DAY_MS, timezone)),
    timezone,
  };
};
