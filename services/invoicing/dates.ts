const TIME_ZONE = 'America/Argentina/Buenos_Aires';

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar day in Argentina as YYYY-MM-DD (the day ARCA and the invoice use, not the UTC one). */
export const argentinaDay = (date: Date): string => dayFormat.format(date);

/** YYYY-MM-DD to ARCA's YYYYMMDD. */
export const toArcaDate = (day: string): string => day.replace(/-/g, '');

/** ARCA's YYYYMMDD to YYYY-MM-DD. */
export const fromArcaDate = (value: string): string => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
