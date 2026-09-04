export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** `YYYY-MM-DD` with nothing after it — a calendar date, not an instant. */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A date, rendered as the day it names.
 *
 * ── ⚠ Date-only strings were rendering a day early ─────────────────────────
 *
 * `new Date('2025-01-20')` is parsed by the spec as **UTC midnight**, and
 * `toLocaleDateString` then renders it in the reader's zone — so anywhere west
 * of Greenwich it printed *Jan 19*. Verified in `America/Los_Angeles`, which is
 * where this product's first users are.
 *
 * Every service date in the database is a calendar date: `service_date` is a
 * `date` column, the invoice says the 20th, and the app said the 19th. Nothing
 * errored, and the number was only ever wrong by one — which is the shape of
 * defect this codebase keeps paying for.
 *
 * `garage-next-service.ts` hit this and fixed it locally, recording that
 * "`formatDate` has the same flaw for every date-only string in the product and
 * that is a wider change than this file should make on its way past". This is
 * that wider change.
 *
 * ⚠ Only the date-only shape is intercepted. A full timestamp genuinely is an
 * instant, and converting it to the reader's zone is correct — that is what
 * `formatDateTime` is for, and breaking it here would trade one off-by-one for
 * another.
 */
export function formatDate(date: string | Date): string {
  const calendar = typeof date === 'string' ? DATE_ONLY.exec(date) : null;

  /*
    Built from the parts rather than parsed, so the numbers the string names
    are the numbers rendered, in any zone. `month - 1` because the constructor
    takes a zero-based month and this is exactly where that bites.
  */
  const d = calendar
    ? new Date(Number(calendar[1]), Number(calendar[2]) - 1, Number(calendar[3]))
    : typeof date === 'string'
      ? new Date(date)
      : date;

  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatMileage(miles: number): string {
  return miles.toLocaleString('en-US');
}

export function formatHours(hours: number): string {
  if (hours === 1) return '1 hour';
  return `${hours.toFixed(1)} hours`;
}

export function formatPercentage(value: number, decimals: number = 0): string {
  return `${value.toFixed(decimals)}%`;
}

export function truncateString(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.substring(0, length) + '...';
}

export function capitalizeWords(str: string): string {
  return str
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
