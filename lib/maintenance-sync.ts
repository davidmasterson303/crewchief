export interface SyncResult {
  synced: boolean;
  lastServiceMileage: number;
  lastServiceDate: string | null;
  sourceName: string | null;
}

interface HistoryItem {
  item_description?: string;
  description?: string;
  service_date?: string;
  date_completed?: string;
  service_mileage?: number;
  mileage_at_service?: number;
  cost_parts?: number;
  cost_labor?: number;
  total_cost?: number;
}

interface DismissalItem {
  category_key: string;
  confirmed_mileage: number;
  created_at: string;
}

const CATEGORY_KEYWORD_MAP: Record<string, string[]> = {
  'Oil Change': ['oil change', 'oil & filter', 'oil and filter', 'motor oil', 'engine oil', 'lube', 'oil service', 'full synthetic', 'conventional oil', 'synthetic blend', 'mobil', 'pennzoil', 'valvoline', 'castrol'],
  'Tire Rotation': ['tire rotation', 'tyre rotation', 'rotate tires', 'rotate tyres', 'wheel rotation', 'tire service'],
  'Air Filter': ['air filter', 'engine air filter', 'engine filter', 'intake filter', 'k&n', 'fram air', 'wix air'],
  'Cabin Air Filter': ['cabin filter', 'cabin air filter', 'pollen filter', 'hvac filter', 'interior filter'],
  'Brake Inspection': ['brake inspection', 'brake check', 'brake pad', 'brake pads', 'brake rotor', 'brake disc', 'brake caliper', 'brake service', 'disc brake', 'front brakes', 'rear brakes'],
  'Spark Plugs': ['spark plug', 'spark plugs', 'ignition plug', 'ngk', 'denso plug', 'bosch plug', 'iridium plug', 'platinum plug', 'ignition coil', 'tune up', 'tune-up'],
  'Transmission Fluid': ['transmission fluid', 'trans fluid', 'atf', 'gear oil', 'gearbox fluid', 'cvt fluid', 'dct fluid', 'automatic transmission', 'manual transmission fluid'],
  'Coolant Flush': ['coolant flush', 'coolant change', 'antifreeze', 'radiator flush', 'coolant service', 'engine coolant', 'coolant replacement'],
  'Brake Fluid': ['brake fluid', 'dot 3', 'dot 4', 'dot 5', 'brake fluid flush', 'hydraulic fluid'],
  'Timing Belt': ['timing belt', 'timing chain', 'cam belt', 'serpentine belt', 'drive belt', 'timing kit'],
};

export function getKeywordsForCategory(categoryName: string): string[] {
  return CATEGORY_KEYWORD_MAP[categoryName] || [];
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function getItemText(item: HistoryItem): string {
  return normalizeText(item.item_description || item.description || '');
}

function getItemMileage(item: HistoryItem): number {
  return item.service_mileage || item.mileage_at_service || 0;
}

function getItemDate(item: HistoryItem): string | null {
  return item.service_date || item.date_completed || null;
}

export function syncCategoryFromHistory(
  categoryName: string,
  historyItems: HistoryItem[],
  dismissals: DismissalItem[],
  currentMileage: number
): SyncResult {
  const dismissal = dismissals
    .filter(d => d.category_key === categoryName)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

  if (dismissal) {
    return {
      synced: true,
      lastServiceMileage: dismissal.confirmed_mileage,
      lastServiceDate: dismissal.created_at,
      sourceName: 'Verified by Owner',
    };
  }

  const keywords = getKeywordsForCategory(categoryName);
  if (!keywords.length) return { synced: false, lastServiceMileage: 0, lastServiceDate: null, sourceName: null };

  const matches = historyItems
    .map(item => {
      const text = getItemText(item);
      const matched = keywords.some(kw => text.includes(kw));
      return matched ? item : null;
    })
    .filter(Boolean) as HistoryItem[];

  if (!matches.length) return { synced: false, lastServiceMileage: 0, lastServiceDate: null, sourceName: null };

  matches.sort((a, b) => {
    const dateA = getItemDate(a);
    const dateB = getItemDate(b);
    if (dateA && dateB) return new Date(dateB).getTime() - new Date(dateA).getTime();
    const milA = getItemMileage(a);
    const milB = getItemMileage(b);
    return milB - milA;
  });

  const best = matches[0];
  const mileage = getItemMileage(best) || currentMileage;

  return {
    synced: true,
    lastServiceMileage: mileage,
    lastServiceDate: getItemDate(best),
    sourceName: best.item_description || best.description || null,
  };
}
