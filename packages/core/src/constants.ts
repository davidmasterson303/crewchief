export const VIN_LENGTH = 17;
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const ALLOWED_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

export const NHTSA_API_BASE = 'https://vpic.nhtsa.dot.gov/api/vehicles';
export const NHTSA_DECODE_VIN_URL = (vin: string) => `${NHTSA_API_BASE}/DecodeVinValues/${vin}?format=json`;

export const API_TIMEOUTS = {
  DEFAULT: 30000,
  LONG_RUNNING: 60000,
  SHORT: 5000,
} as const;

export const RETRY_CONFIG = {
  MAX_RETRIES: 3,
  INITIAL_DELAY: 1000,
  MAX_DELAY: 10000,
} as const;

export const CACHE_TTL = {
  VEHICLE: 1000 * 60 * 30,
  MAINTENANCE: 1000 * 60 * 15,
  MODIFICATIONS: 1000 * 60 * 60,
  CONSULTANT: 1000 * 60 * 5,
} as const;

export const MODIFICATION_DIFFICULTY = {
  EASY: 'Easy',
  MODERATE: 'Moderate',
  HARD: 'Hard',
} as const;

export const SERVICE_STATUS = {
  WISHLIST: 'wishlist',
  PURCHASED: 'purchased',
  SCHEDULED: 'scheduled',
  COMPLETED: 'completed',
} as const;

export const SERVICE_CATEGORY = {
  MAINTENANCE: 'maintenance',
  MODIFICATION: 'modification',
  REPAIR: 'repair',
  UPGRADE: 'upgrade',
} as const;

export const ISSUE_SEVERITY = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
} as const;

export const PERFORMANCE_MINDEDNESS = {
  STOCK: 'stock',
  MILD: 'mild',
  AGGRESSIVE: 'aggressive',
} as const;

export const RESEARCH_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
  UNSUPPORTED: 'unsupported',
} as const;
