/**
 * Parsing for the consultant's agentic write-back commands.
 *
 * The LLM emits structured tags mid-response ([ADD_TO_WISHLIST: ...] etc.).
 * Parsing lives here as pure functions so it can be unit-tested against
 * malformed/adversarial model output; the DB side effects stay in the
 * server action.
 */

export interface WishlistCommand {
  name: string;
  type: string;
  description: string;
}

export interface StatusCommand {
  identifier: string;
  status: 'completed' | 'not_interested';
}

export type PerfStats = Record<string, number>;

const VALID_STATUSES = new Set(['completed', 'not_interested']);

export function parseWishlistCommands(response: string): { commands: WishlistCommand[]; cleaned: string } {
  const commands: WishlistCommand[] = [];
  const regex = /\[ADD_TO_WISHLIST:\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^\]]+)\]/g;
  let match;
  while ((match = regex.exec(response)) !== null) {
    const name = match[1].trim();
    const type = match[2].trim();
    const description = match[3].trim();
    if (name.length >= 2) commands.push({ name, type, description });
  }
  return { commands, cleaned: response.replace(/\[ADD_TO_WISHLIST:\s*[^\]]+\]/g, '').trim() };
}

export function parsePerformanceCommands(response: string): { updates: PerfStats[]; cleaned: string } {
  const updates: PerfStats[] = [];
  const regex = /\[UPDATE_PERFORMANCE_STATS:\s*([^\]]+)\]/g;
  let match;
  while ((match = regex.exec(response)) !== null) {
    const stats: PerfStats = {};
    match[1].split('|').forEach((part: string) => {
      const [key, val] = part.split('=').map((s: string) => s.trim());
      const num = parseFloat(val);
      if (key && !isNaN(num)) stats[key] = num;
    });
    if (Object.keys(stats).length > 0) updates.push(stats);
  }
  return { updates, cleaned: response.replace(/\[UPDATE_PERFORMANCE_STATS:\s*[^\]]+\]/g, '').trim() };
}

export function parseStatusCommands(
  response: string,
  tag: 'UPDATE_ISSUE_STATUS' | 'UPDATE_MOD_STATUS'
): { commands: StatusCommand[]; cleaned: string } {
  const commands: StatusCommand[] = [];
  const regex = new RegExp(`\\[${tag}:\\s*([^|]+)\\|([^\\]]+)\\]`, 'g');
  let match;
  while ((match = regex.exec(response)) !== null) {
    const identifier = match[1].trim();
    const status = match[2].trim();
    if (!identifier || identifier.length < 2) {
      console.warn(`[${tag}] Skipped: invalid identifier`, JSON.stringify(identifier));
      continue;
    }
    if (VALID_STATUSES.has(status)) {
      commands.push({ identifier, status: status as StatusCommand['status'] });
    }
  }
  const cleaned = response.replace(new RegExp(`\\[${tag}:\\s*[^\\]]+\\]`, 'g'), '').trim();
  return { commands, cleaned };
}

export function parseInvoiceFlag(response: string): { flagged: boolean; cleaned: string } {
  return {
    flagged: response.includes('[PROCESS_INVOICE]'),
    cleaned: response.replace(/\[PROCESS_INVOICE\]/g, '').trim(),
  };
}
