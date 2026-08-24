/**
 * What the app has to say before a person's data reaches a third-party AI.
 *
 * ── ⚠ Guideline 5.1.2(i), amended November 2025 (LEG-02) ────────────────────
 *
 * Apple now requires **explicit permission** before personal data is shared
 * with a third-party AI — not disclosure, permission. CrewChief has the
 * disclosure: the privacy policy names Google and says what goes there. The
 * only *consent* was sign-up wrap, which is not what the amendment asks for.
 *
 * ── Why the copy lives in `core` ────────────────────────────────────────────
 *
 * Because it has to be identical on both clients, and because this codebase's
 * most repeated defect is a capability that lives in one client and is silently
 * absent from the other. A consent sheet whose wording differs between the web
 * upload dialog and `InvoiceScanScreen` is two different consents, and only one
 * of them is the one somebody actually gave.
 *
 * ── ⚠ It names Google, and it names what leaves ─────────────────────────────
 *
 * "Third-party AI services" is the phrasing that satisfies nobody. The
 * amendment is about a person being able to decide, and deciding needs to know
 * **who** and **what** — so the copy says Google, and says the invoice carries
 * a shop's name and address as well as the owner's own car.
 *
 * That last part is the one somebody would not think of: an invoice is not only
 * their data. `LEG-09` is the same fact from the retention side.
 */

export interface AiConsentCopy {
  title: string;
  body: string;
  /** What the person is agreeing to. Short, and each item is a real fact. */
  points: readonly string[];
  accept: string;
  decline: string;
  /** What declining costs, said plainly so the choice is a real one. */
  declineNote: string;
}

/**
 * The sheet shown before the first invoice scan.
 *
 * ⚠ This screen photographs a document carrying **a third party's name and
 * business address**, sometimes a VIN, and sends it to Google. It said nothing
 * about that at all.
 */
export const INVOICE_AI_CONSENT: AiConsentCopy = {
  title: 'Reading an invoice uses Google’s AI',
  body:
    'To pull the line items off a photograph, CrewChief sends the image to Google’s Gemini service. Before that happens, it is worth knowing what is in it.',
  points: [
    'The photograph goes to Google, not just the text we read from it.',
    'An invoice usually carries the shop’s name and address as well as your car’s.',
    'We do not publish it, and we do not sell it.',
  ],
  accept: 'Scan invoices',
  decline: 'Not now',
  declineNote:
    'You can still add services by hand, and everything else in CrewChief works the same. Ask again any time from a scan.',
};

/**
 * The sheet shown before the first advisor question.
 *
 * ⚠ Narrower than the invoice one, deliberately: what goes to Google here is
 * this car's own records and the question typed — no images, no third party's
 * details. Saying so is more useful than one generic warning covering both, and
 * a person who agreed to the invoice sheet has already agreed to more.
 */
export const ADVISOR_AI_CONSENT: AiConsentCopy = {
  title: 'The advisor is Google’s AI',
  body:
    'CrewChief sends your question and this car’s records — its service history, its open recalls, the mileage you have recorded — to Google’s Gemini service to answer.',
  points: [
    'Your question and this car’s records go to Google.',
    'No photographs and no documents are sent from here.',
    'We do not publish it, and we do not sell it.',
  ],
  accept: 'Ask the advisor',
  decline: 'Not now',
  declineNote:
    'Everything else in CrewChief works the same without it. Ask again any time from this screen.',
};
