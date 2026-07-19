export const DEMO_COOKIE = 'crewchief_demo';
export const DEMO_VEHICLE_IDS = [
  'a1000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000002',
  'a3000000-0000-0000-0000-000000000003',
] as const;

export function isDemoVehicleId(vehicleId: string): boolean {
  return DEMO_VEHICLE_IDS.includes(vehicleId as any);
}

export function setDemoMode(): void {
  if (typeof document !== 'undefined') {
    document.cookie = `${DEMO_COOKIE}=1; path=/; max-age=86400; SameSite=Lax`;
  }
}

export function clearDemoMode(): void {
  if (typeof document !== 'undefined') {
    document.cookie = `${DEMO_COOKIE}=; path=/; max-age=0`;
  }
}

export function isDemoMode(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((c) => c.trim().startsWith(`${DEMO_COOKIE}=1`));
}

export const DEMO_IMAGES: Record<string, string> = {
  'a1000000-0000-0000-0000-000000000001': 'https://images.pexels.com/photos/19316798/pexels-photo-19316798.jpeg?auto=compress&cs=tinysrgb&w=800',
  'a2000000-0000-0000-0000-000000000002': 'https://images.pexels.com/photos/16685589/pexels-photo-16685589.jpeg?auto=compress&cs=tinysrgb&w=800',
  'a3000000-0000-0000-0000-000000000003': 'https://images.pexels.com/photos/12330349/pexels-photo-12330349.jpeg?auto=compress&cs=tinysrgb&w=800',
};
