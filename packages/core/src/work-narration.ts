/**
 * What the app actually read, said in words, in place of a progress animation.
 *
 * ── ⚠ D13 / UX-15 · the hero ran a timer and called it a diagnostic ─────────
 *
 * `DiagnosticHero` swept a cyan scan line across the photograph for 850ms and
 * flipped a caption from *"Scanning…"* to *"Diagnostics complete"* on a 900ms
 * `setTimeout`. Nothing was scanned. The score on the screen had been fetched
 * with the page, the recall list with it, and the timer was measuring only
 * itself — it would have said "Diagnostics complete" over a car with no
 * records, no recall lookup and no assessment at all.
 *
 * Simulated progress is a common and defensible pattern, and that is genuinely
 * why this is a judgement call rather than a bug report. It is wrong *here* for
 * a reason specific to this product: the entire proposition is that CrewChief
 * tells you the truth about your car, including when the truth is "I do not
 * know yet". A fake diagnostic animation, on the screen whose job is to look
 * like it did diagnostic work, is the one place the pattern costs something
 * real — and it sits directly above a dial that was independently inventing a
 * reading (D10). Two fabrications, one screen, reinforcing each other.
 *
 * ── The beat survives; only the lie is removed ──────────────────────────────
 *
 * The instinct behind the animation was sound: an instant answer feels
 * unearned, and a moment of assembly makes it feel considered. So this does not
 * delete the beat, it gives it something true to count — *the records actually
 * read*. A car with 12 invoices counts to 12 because there were twelve; a car
 * with none counts to nothing and says so, which is precisely the case the old
 * caption congratulated itself over.
 *
 * ── Why counts and not a percentage ────────────────────────────────────────
 *
 * A percentage needs a denominator, and there is no such thing as "how much of
 * this car is known". Counts are facts the database holds and can be checked by
 * anyone who scrolls down to the service log and counts the rows. That is the
 * same standard `health-drivers.ts` sets for the drivers: every input is a fact
 * the database holds.
 */

export interface ReadWork {
  /**
   * Service records on file for this vehicle.
   *
   * `null` means the read failed or never ran — not zero. The two are different
   * claims and only one of them is about the car.
   */
  serviceRecords: number | null;
  /**
   * Recall campaigns matched for this vehicle's year, make and model.
   *
   * ⚠ `null` when the NHTSA lookup has **not** run or did not resolve, which is
   * not the same as a lookup that ran and matched nothing. `nhtsa-lookup.ts`
   * answers that question and is the only thing that should; passing `0` for an
   * unchecked vehicle is the "absence as all-clear" defect this codebase has
   * now paid for three times.
   */
  recalls: number | null;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * The number the beat counts to: how many records were actually read.
 *
 * Recalls are deliberately **not** added in. A recall campaign is not a record
 * the owner filed, and summing the two would produce a single figure that
 * describes nothing — the sort of composite number that looks like a
 * measurement and answers no question.
 */
export function readWorkCount(work: ReadWork): number {
  return work.serviceRecords ?? 0;
}

/**
 * One line naming what this assessment was built from.
 *
 * ⚠ Always says something. There is no state in which this returns an empty
 * string, because the caption's slot on the hero is fixed and an empty one
 * would collapse the layout into the shape it has while "loading" — reviving,
 * visually, the ambiguity this module exists to end.
 */
export function describeReadWork(work: ReadWork): string {
  const { serviceRecords, recalls } = work;

  const parts: string[] = [];

  if (serviceRecords !== null && serviceRecords > 0) {
    parts.push(plural(serviceRecords, 'service record'));
  }

  /*
    A matched campaign is worth naming; a clean check is worth naming too, and
    they are different sentences. "0 recall campaigns" would be true and would
    read as an absence of work rather than as a completed check, so the checked
    case says so in words.
  */
  if (recalls !== null && recalls > 0) {
    parts.push(plural(recalls, 'recall campaign'));
  }

  if (parts.length > 0) {
    const list = parts.length === 1 ? parts[0] : `${parts[0]} and ${parts[1]}`;
    return `Read ${list}.`;
  }

  /*
    Nothing was read. This is the state the old caption rendered as "Diagnostics
    complete", and it is the one the owner most needs the truth about — it is
    also the only one they can fix, which is why the hero pairs this line with
    an action rather than leaving it as a complaint.
  */
  if (serviceRecords === 0 && recalls === 0) {
    return 'No service records on file, and no recalls found for this year, make and model.';
  }

  if (serviceRecords === 0) return 'No service records on file yet.';

  return 'Nothing read for this car yet.';
}
