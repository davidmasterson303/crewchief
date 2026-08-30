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
 * a reason specific to this product: the entire proposition is that Well Kept
 * tells you the truth about your car, including when the truth is "I do not
 * know yet". A fake diagnostic animation, on the screen whose job is to look
 * like it did diagnostic work, is the one place the pattern costs something
 * real — and it sits directly above a dial that was independently inventing a
 * reading (D10). Two fabrications, one screen, reinforcing each other.
 *
 * ── ⚠ The beat survives, and that is David's call rather than a concession ──
 *
 * `CODE_HANDOFF_2026-08-24.md` §1.4 is explicit and it corrects an earlier
 * reading of this decision: *"not to remove the beat but to make it narrate
 * something real — count up the records actually read… Same reassurance, no
 * fiction."*
 *
 * The instinct behind the animation was sound. An instant answer feels
 * unearned, and a moment of assembly makes it feel considered; deleting the
 * moment throws that away to fix a problem that was never the moment's fault.
 * What was wrong was the *subject* — a timer counting itself. So the beat keeps
 * its job and changes what it counts: a car with 12 invoices counts to 12
 * because there were twelve.
 *
 * ⚠ **Where there is nothing to narrate, narrate nothing.** The same section
 * says so — *"show nothing rather than a timer"* — which is why
 * `describeReadWork` returns `null` rather than a consolation sentence. A
 * caption that fills its slot with "nothing read yet" is still a slot being
 * filled to avoid looking empty, and that is the instinct this whole finding is
 * about.
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
 * Whether there is anything true to say about this vehicle's records.
 *
 * ⚠ The caller renders **no caption at all** when this is false. See the
 * docblock: an empty slot is the honest shape for "we have nothing to report",
 * and filling it with a sentence about having nothing is the same reflex that
 * produced a timer.
 */
export function hasReadWorkToNarrate(work: ReadWork): boolean {
  return describeReadWork(work) !== null;
}

/**
 * One line naming what this assessment was built from, or `null` for nothing.
 *
 * ── ⚠ `shown` is how the beat counts without a second copy of the sentence ──
 *
 * The caller animates a number from 0 to `readWorkCount(work)` and passes each
 * frame's value here. The **shape** of the sentence is decided from `work` —
 * the real, settled figures — and only the numeral is substituted, so a car
 * with twelve invoices reads "Read 3 service records" mid-sweep and "Read 12
 * service records" at rest. It never passes through the *no records* phrasing
 * on its way up, which is what would happen if the sentence were re-derived
 * from the animated value each frame.
 *
 * That is the whole reason this takes a parameter rather than the hero
 * assembling its own string around a number: one sentence, one place, and the
 * animation cannot invent a phrasing the settled state would not use.
 */
export function describeReadWork(work: ReadWork, shown?: number): string | null {
  const { serviceRecords, recalls } = work;

  const parts: string[] = [];

  if (serviceRecords !== null && serviceRecords > 0) {
    /*
      ⚠ Pluralised on the **displayed** count, not the real one. "Read 1 service
      records" during a sweep toward 12 is the kind of wrong that makes an
      honest caption look broken.
    */
    const count = shown === undefined ? serviceRecords : Math.max(0, Math.round(shown));
    parts.push(plural(count, 'service record'));
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

    ⚠ Both branches below describe a **completed check that found nothing**,
    which is a real result and worth saying. They are not the "nothing to
    narrate" case.
  */
  if (serviceRecords === 0 && recalls === 0) {
    return 'No service records on file, and no recalls found for this year, make and model.';
  }

  if (serviceRecords === 0) return 'No service records on file yet.';

  /*
    ⚠ Neither read resolved — we did not look, or looking failed. There is
    nothing true to say, so nothing is said. Handoff §1.4: "Where there is
    genuinely nothing to narrate, show nothing rather than a timer."
  */
  return null;
}
