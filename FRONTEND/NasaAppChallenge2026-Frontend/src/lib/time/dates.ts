/**
 * Utilidades de fecha en UTC. Todas las fechas del dominio son `YYYY-MM-DD` (UTC),
 * igual que `acq_date` de FIRMS. Internamente se usan índices de día desde la época Unix.
 */
export type ISODate = string;

const DAY_MS = 86_400_000;

export function dayIndexFromISO(iso: ISODate): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function isoFromDayIndex(index: number): ISODate {
  return new Date(index * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(iso: ISODate, days: number): ISODate {
  return isoFromDayIndex(dayIndexFromISO(iso) + days);
}

export function addMonths(iso: ISODate, months: number): ISODate {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return dayIndexFromISO(a) - dayIndexFromISO(b);
}

export function yearOf(iso: ISODate): number {
  return Number(iso.slice(0, 4));
}

export function monthOf(iso: ISODate): number {
  return Number(iso.slice(5, 7));
}

/** Día del año (1..366). */
export function dayOfYear(index: number): number {
  const date = new Date(index * DAY_MS);
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((index * DAY_MS - start) / DAY_MS) + 1;
}

export function monthStart(iso: ISODate): ISODate {
  return `${iso.slice(0, 7)}-01`;
}

export function monthEnd(iso: ISODate): ISODate {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function yearStart(year: number): ISODate {
  return `${year}-01-01`;
}

export function yearEnd(year: number): ISODate {
  return `${year}-12-31`;
}

export function clampDate(iso: ISODate, min: ISODate, max: ISODate): ISODate {
  if (iso < min) return min;
  if (iso > max) return max;
  return iso;
}

export function isValidISODate(value: string | null | undefined): value is ISODate {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return isoFromDayIndex(dayIndexFromISO(value)) === value;
}

/** Recorre fechas (incluidas ambas puntas). */
export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const a = dayIndexFromISO(from);
  const b = dayIndexFromISO(to);
  for (let i = a; i <= b; i++) out.push(isoFromDayIndex(i));
  return out;
}

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_LONG_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const WEEKDAYS_ES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

export function monthShort(month1: number): string {
  return MONTHS_ES[(month1 - 1 + 12) % 12];
}

export function monthLong(month1: number): string {
  return MONTHS_LONG_ES[(month1 - 1 + 12) % 12];
}

export function weekdayShort(iso: ISODate): string {
  return WEEKDAYS_ES[new Date(dayIndexFromISO(iso) * DAY_MS).getUTCDay()];
}

/** "12 sep 2026" */
export function formatDate(iso: ISODate): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS_ES[m - 1]} ${y}`;
}

/** "septiembre 2026" */
export function formatMonth(iso: ISODate): string {
  const [y, m] = iso.split('-').map(Number);
  return `${MONTHS_LONG_ES[m - 1]} ${y}`;
}

/** Día de la semana (0 = domingo) en UTC. */
export function weekday(iso: ISODate): number {
  return new Date(dayIndexFromISO(iso) * DAY_MS).getUTCDay();
}
