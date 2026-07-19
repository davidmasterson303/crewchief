import { supabase } from './supabase';

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1517026575992-5e15ad95f780?q=80&w=2340&auto=format&fit=crop';

export async function getVehicleImage(vehicleId: string, vehicle: any): Promise<string> {
  // 1. Check Cache
  const { data: vehicleData } = await supabase
    .from('vehicles')
    .select('image_url, processed_image_at')
    .eq('id', vehicleId)
    .maybeSingle();

  // Return immediately if we already have a valid non-fallback image URL.
  // This protects manually set image_url values (e.g. demo vehicles) from being overwritten
  // by the Google image search even when processed_image_at is null.
  if (vehicleData?.image_url && vehicleData.image_url !== FALLBACK_IMAGE) {
    if (!vehicleData.processed_image_at) {
      return vehicleData.image_url;
    }
    const imageAge = Date.now() - new Date(vehicleData.processed_image_at).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    if (imageAge < sevenDaysMs) {
      return vehicleData.image_url;
    }
  }

  // 2. Fetch New Image
  try {
    console.log(`[CrewChief] Fetching image for: ${vehicle.color} ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    const imageUrl = await fetchVehicleImage(vehicle.year, vehicle.make, vehicle.model, vehicle.color);

    await supabase
      .from('vehicles')
      .update({
        image_url: imageUrl,
        processed_image_at: new Date().toISOString(),
      })
      .eq('id', vehicleId);

    return imageUrl;
  } catch (error) {
    console.error('Failed to fetch vehicle image:', error);
    return FALLBACK_IMAGE;
  }
}

async function fetchVehicleImage(year: number, make: string, model: string, color?: string): Promise<string> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

  if (!apiKey || !searchEngineId) {
    console.error('[CrewChief] GOOGLE_SEARCH_API_KEY or GOOGLE_SEARCH_ENGINE_ID is not set. Set them in your .env file (see .env.example). Vehicle image search will use the fallback image.');
    return FALLBACK_IMAGE;
  }

  const colorPart = color ? ` "${color}"` : '';
  const queries = [
    `"${year} ${make} ${model}"${colorPart} car photo -poster -art -print -wallpaper -drawing -illustration -render -diecast -toy -miniature`,
    `${year} ${make} ${model}${colorPart} exterior photograph -poster -art -print -drawing -render`,
  ];

  for (const searchQuery of queries) {
    try {
      const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(searchQuery)}&searchType=image&imgSize=xlarge&imgType=photo&fileType=jpg&key=${apiKey}&cx=${searchEngineId}&num=10`;

      const response = await fetch(url);
      if (!response.ok) continue;

      const data = await response.json();
      if (!data.items || data.items.length === 0) continue;

      const excludePatterns = /poster|art|print|illustration|drawing|render|wallpaper|diecast|miniature|shirt|canvas|framed|etsy|redbubble|teepublic|zazzle|society6/i;

      const candidates = data.items.filter((item: any) => {
        const title = (item.title || '').toLowerCase();
        const link = (item.link || '').toLowerCase();
        const displayLink = (item.displayLink || '').toLowerCase();
        if (excludePatterns.test(title) || excludePatterns.test(link) || excludePatterns.test(displayLink)) return false;
        const w = item.image?.width || 0;
        const h = item.image?.height || 0;
        if (w > 0 && h > 0 && (h / w > 1.2)) return false;
        return true;
      });

      if (candidates.length === 0) continue;

      const modelLower = model.toLowerCase();
      const yearStr = String(year);
      const colorLower = (color || '').toLowerCase();

      const scored = candidates.map((item: any) => {
        const title = (item.title || '').toLowerCase();
        const context = (item.snippet || '').toLowerCase();
        let score = 0;
        if (title.includes(yearStr)) score += 3;
        if (title.includes(modelLower)) score += 3;
        if (colorLower && title.includes(colorLower)) score += 5;
        if (colorLower && context.includes(colorLower)) score += 2;
        const autoSites = /cargurus|autotrader|cars\.com|edmunds|caranddriver|motortrend|kbb|carfax|autoblog|bmwblog|carbuzz/i;
        if (autoSites.test(item.displayLink || '')) score += 4;
        return { item, score };
      });

      scored.sort((a: any, b: any) => b.score - a.score);

      for (const { item } of scored.slice(0, 3)) {
        const imageUrl = item.link;
        const isValid = await validateImageUrl(imageUrl);
        if (isValid) {
          console.log(`[VehicleImages] Found valid image: ${imageUrl.substring(0, 100)}`);
          return imageUrl;
        }
      }
    } catch (error) {
      console.warn('[VehicleImages] Search query failed:', (error as Error).message);
      continue;
    }
  }

  console.warn('[VehicleImages] No valid images found, using fallback');
  return FALLBACK_IMAGE;
}

async function validateImageUrl(url: string): Promise<boolean> {
  try {
    if (!url || url === FALLBACK_IMAGE) {
      return true;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn('[VehicleImages] Invalid image URL (bad status):', response.status, url.substring(0, 100));
      return false;
    }

    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.startsWith('image/')) {
      console.warn('[VehicleImages] Invalid image URL (not an image):', contentType, url.substring(0, 100));
      return false;
    }

    return true;
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes('abort')) {
      console.warn('[VehicleImages] Image URL validation timeout:', url.substring(0, 100));
    } else {
      console.warn('[VehicleImages] Failed to validate image URL:', message);
    }
    return false;
  }
}
