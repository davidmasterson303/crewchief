interface ServiceItem {
  id: string;
  description: string;
  service_category?: string;
}

export function generateDefaultQuoteName(items: ServiceItem[]): string {
  if (!items || items.length === 0) {
    return `Quote - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }

  const categories = new Set<string>();
  const itemDescriptions: string[] = [];

  items.forEach(item => {
    if (item.service_category) {
      categories.add(item.service_category.toLowerCase());
    }
    if (item.description) {
      itemDescriptions.push(item.description);
    }
  });

  let baseName = '';

  if (categories.size === 1) {
    const category = Array.from(categories)[0];
    if (category === 'maintenance') {
      baseName = 'Maintenance';
    } else if (category === 'repair') {
      baseName = 'Repair';
    } else if (category === 'upgrade') {
      baseName = 'Upgrade';
    } else if (category === 'modification') {
      baseName = 'Modification';
    } else {
      baseName = category.charAt(0).toUpperCase() + category.slice(1);
    }
  } else if (categories.size > 1) {
    baseName = 'Service & Maintenance';
  } else {
    baseName = 'Service';
  }

  const itemCount = items.length;
  const countSuffix = itemCount === 1 ? 'Item' : 'Items';
  const dateStr = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return `${baseName} Quote - ${itemCount} ${countSuffix} (${dateStr})`;
}
