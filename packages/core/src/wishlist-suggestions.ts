import { wishlistItemIdentifier, type WishlistItemType } from './wishlist-identifier';

/**
 * What this car could have on its wishlist, out of what we already know about it.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 *
 * `WishlistScreen` shipped with a free-text box and a docblock defending it:
 * *"The web adds items from three places — the dossier, the consultant, and a
 * manual dialog — because it has the surfaces that suggest them. The phone has
 * none of those yet, so a free-text add is the honest version."*
 *
 * That was true when written and is not any more. The phone loads
 * `vehicle_knowledge_base` on three screens, and `BuildScreen` already reads
 * `common_mods` out of it to build a ladder. The suggestions were sitting in a
 * payload the wishlist screen was already one route away from.
 *
 * David, 23 Aug: *"it can't just be free entry, we need some combo of list of
 * suggestions with CTAs to Add or Learn More, and list should be filterable
 * with type ahead."*
 *
 * ── Three sources, and they map exactly onto the three item types ───────────
 *
 * Verified against the live knowledge base rather than assumed:
 *
 *   known_issues         { part, severity, description, mileage_range }  → issue
 *   maintenance_schedule { service, priority, description, interval_* }  → maintenance
 *   common_mods          { name, purpose, difficulty }                   → modification
 *
 * `wishlist_items.item_type` is exactly `issue | maintenance | modification`,
 * so nothing has to be invented to make them fit — which is the good sign that
 * this was always the intended shape.
 *
 * ── ⚠ Urgency is read, never inferred ──────────────────────────────────────
 *
 * `native-wishlist.spec.html`: *"Priority chips are neutral unless the item is
 * genuinely urgent. Semantic colour does semantic work only."* So exactly two
 * things can raise a chip out of neutral — a `High` severity on a known issue
 * and a `Critical` priority on a scheduled service — and both are values the
 * research wrote, not judgements made here. Everything else gets its type in
 * plain words.
 *
 * A product that colours half its list amber has taught its owner that amber
 * means nothing.
 *
 * ── ⚠ 23 Aug (R40): the chip names the **kind**, never the priority ─────────
 *
 * `chip` used to read `Do first` whenever `urgent` was true. The list is sorted
 * urgent-first, so every row on the first screenful carried it — reported as
 * *"`Do first` on four consecutive rows says nothing. A priority chip that every
 * visible row carries is decoration."* And it was true twice over: the chip was
 * redundant with the row's **position**, and it cost the row the one fact the
 * chip is for, which is what kind of thing this is.
 *
 * Urgency is carried by the order and by the section the row sits in. The chip
 * says `Known issue`, `Service` or `Modification`, and `urgent` still colours
 * it — so an exception in a long scrolled list is still visible on its own.
 */

export interface WishlistSuggestion {
  /** What goes in `item_name`, and what the row is titled. */
  name: string;
  type: WishlistItemType;
  /** One line saying why it is worth doing. Never empty — see `reasonOf`. */
  reason: string;
  /**
   * The chip: what **kind** of thing this is — `Known issue`, `Service`,
   * `Modification`.
   *
   * ⚠ Never the priority. See the header: a chip that repeats the sort order is
   * decoration, and it displaces the one fact only the chip can carry.
   *
   * `urgent` is the only value that may colour it.
   */
  chip: string;
  urgent: boolean;
  /** The dedupe key, so a caller never builds a fourth spelling of one. */
  identifier: string;
  /** Free-text extras a detail view can show — mileage window, interval, effort. */
  note: string | null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * One row of a `jsonb` array, as an object it is safe to read keys off.
 *
 * ⚠ `row as Record<string, unknown>` is **not** enough, and the test caught it:
 * a `null` element passes the cast and throws on the first property access.
 * These arrays are written by a model into a `jsonb` column, so a null, a
 * number or a bare string are all shapes that can genuinely arrive — and a
 * crash here is a blank screen on the one surface that exists to suggest
 * things.
 */
function row(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * The sentence under the name.
 *
 * ⚠ Never returns an empty string. A row with a blank second line reads as a
 * row that failed to load, and the whole argument for suggesting something is
 * the reason attached to it — a bare part name is a catalogue, which is the
 * thing `mod-progression.ts` exists to say this product is not.
 */
function reasonOf(description: string | null, fallback: string): string {
  return description ?? fallback;
}

/** `known_issues` → suggestions. */
function fromIssues(rows: unknown): WishlistSuggestion[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((entry) => {
    const record = row(entry);
    const name = text(record.part);
    if (!name) return [];

    const severity = (text(record.severity) ?? '').toLowerCase();
    const urgent = severity === 'high' || severity === 'critical';
    const window = text(record.mileage_range);

    return [
      {
        name,
        type: 'issue' as const,
        reason: reasonOf(text(record.description), 'A known problem on this engine.'),
        chip: 'Known issue',
        urgent,
        identifier: wishlistItemIdentifier('issue', name),
        note: window ? `Typically ${window}` : null,
      },
    ];
  });
}

/** `maintenance_schedule` → suggestions. */
function fromSchedule(rows: unknown): WishlistSuggestion[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((entry) => {
    const record = row(entry);
    const name = text(record.service);
    if (!name) return [];

    const priority = (text(record.priority) ?? '').toLowerCase();
    const urgent = priority === 'critical';

    const miles = typeof record.interval_miles === 'number' ? record.interval_miles : null;
    const months = typeof record.interval_months === 'number' ? record.interval_months : null;
    const interval =
      miles && months
        ? `Every ${miles.toLocaleString('en-US')} mi or ${months} months`
        : miles
          ? `Every ${miles.toLocaleString('en-US')} mi`
          : months
            ? `Every ${months} months`
            : null;

    return [
      {
        name,
        type: 'maintenance' as const,
        reason: reasonOf(text(record.description), 'Part of this car’s service schedule.'),
        chip: 'Service',
        urgent,
        identifier: wishlistItemIdentifier('maintenance', name),
        note: interval,
      },
    ];
  });
}

/** `common_mods` → suggestions. Never urgent: a modification is never overdue. */
function fromMods(rows: unknown): WishlistSuggestion[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((entry) => {
    const record = row(entry);
    const name = text(record.name);
    if (!name) return [];

    return [
      {
        name,
        type: 'modification' as const,
        reason: reasonOf(text(record.purpose), 'A common modification for this car.'),
        /*
          ⚠ Never `urgent`. Nothing an owner chooses to add to a car is
          overdue, and an amber chip on a cold-air intake next to one on a
          failing rod bearing is how amber stops meaning anything.
        */
        chip: 'Modification',
        urgent: false,
        identifier: wishlistItemIdentifier('modification', name),
        note: text(record.difficulty),
      },
    ];
  });
}

/**
 * Everything this car's research suggests, urgent first.
 *
 * ⚠ **Ordered, not grouped.** Grouping by type would put a critical service
 * below a cosmetic modification whenever the alphabet said so. Urgency first,
 * then issues before services before modifications — which is the same
 * "what will hurt you soonest" ordering the progression ladder argues for, and
 * a stable sort inside each tier so the list does not reshuffle between renders.
 */
export function suggestionsFor(knowledge: unknown): WishlistSuggestion[] {
  const record = (knowledge ?? {}) as Record<string, unknown>;

  const all = [
    ...fromIssues(record.known_issues),
    ...fromSchedule(record.maintenance_schedule),
    ...fromMods(record.common_mods),
  ];

  const rank: Record<WishlistItemType, number> = { issue: 0, maintenance: 1, modification: 2 };

  return all
    .map((suggestion, index) => ({ suggestion, index }))
    .sort(
      (a, b) =>
        Number(b.suggestion.urgent) - Number(a.suggestion.urgent) ||
        rank[a.suggestion.type] - rank[b.suggestion.type] ||
        a.index - b.index
    )
    .map(({ suggestion }) => suggestion);
}

/**
 * The typeahead.
 *
 * Matches on the **name and the reason**, because an owner searching "fluid"
 * should find "10th Gen CVT Transmission" — whose reason opens "CVT fluid
 * degradation…". A name-only filter is the version that looks broken to
 * everyone who does not already know the part's formal title, which is most
 * people and is the entire audience for a suggestion list.
 *
 * ⚠ Every term must match, in any field and any order. `catalogKey`'s
 * punctuation-stripping is deliberately **not** reused: this is prose, and
 * collapsing "K&N" to "kn" would stop "k&n" matching itself.
 */
export function filterSuggestions(
  query: string,
  suggestions: readonly WishlistSuggestion[]
): WishlistSuggestion[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...suggestions];

  return suggestions.filter((suggestion) => {
    const haystack = `${suggestion.name} ${suggestion.reason} ${suggestion.chip}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/**
 * A question for the advisor about one suggestion.
 *
 * Built here so the wishlist's "Learn more" and any future caller ask the same
 * way. It names the car and quotes the finding, because the advisor takes the
 * vehicle record in context and a bare part name makes it guess which car and
 * which symptom.
 */
export function learnMoreQuestion(suggestion: WishlistSuggestion, vehicleName: string): string {
  return (
    `Tell me about "${suggestion.name}" on my ${vehicleName}. ` +
    `${suggestion.reason} What does it involve, roughly what does it cost, ` +
    `and how urgent is it for me?`
  );
}
