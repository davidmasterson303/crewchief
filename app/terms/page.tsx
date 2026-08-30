import type { Metadata } from 'next';

import LegalDocument, { LegalSection } from '@/components/legal/LegalDocument';
import { CONTACT_EMAIL, OPERATOR, SUBSCRIPTION_CANCEL_PATH } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Terms of Use · Well Kept',
  description: 'What Well Kept is, what it is not, and the terms of using it.',
};

/**
 * ⚠ **Draft, not reviewed by a lawyer.** Same standing as the privacy policy,
 * and the same reason for existing: guideline 3.1.2 requires a functional link
 * to terms of use in the binary once auto-renewable subscriptions ship, and
 * neither document existed anywhere in this product.
 *
 * ── The section that is not boilerplate ─────────────────────────────────────
 *
 * "What Well Kept is not." A product that tells people things about the safety
 * of a two-tonne object they drive their family around in has a real duty to be
 * clear about what its answers are worth, and that duty is not discharged by a
 * limitation-of-liability clause nobody reads.
 *
 * It is also the same rule the product already follows in its interface:
 * `cc-design-0003` — answers as ranges and comparisons, never verdicts, on
 * every advice surface. This section is that rule written down where it is
 * legally load-bearing, which is why it sits near the top rather than in the
 * disclaimers at the bottom.
 *
 * ── Subscription wording is imported, not restated ──────────────────────────
 *
 * `SUBSCRIPTION_CANCEL_PATH` comes from core, so this page and the in-app
 * deletion notice cannot tell somebody two different ways to stop being
 * charged. See `lib/legal.ts`.
 */
export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of Use"
      summary="Well Kept helps you understand and look after your car. It is not a mechanic, and nothing it tells you is a substitute for someone qualified looking at the actual vehicle."
    >
      <p>
        These terms cover your use of the Well Kept app and website, operated by {OPERATOR}. Using
        Well Kept means you accept them.
      </p>

      <LegalSection>What Well Kept is not</LegalSection>

      <p>
        Well Kept produces estimates, ranges and comparisons from the information you give it and
        from public data about your vehicle. It has never seen your car.
      </p>

      <p>
        <strong className="text-white/90">It is not a safety inspection, a diagnosis, or
        professional advice.</strong> A health score, a maintenance estimate or an answer from the
        advisor is a starting point for a conversation with a qualified mechanic — never a
        replacement for one, and never a reason to delay having something looked at. If you have any
        reason to think your vehicle is unsafe, stop driving it and have it inspected.
      </p>

      <p>
        <strong className="text-white/90">Recall information comes from NHTSA and may lag.</strong> We
        show what their public database returns. An absence of recalls here is not a guarantee that
        none exists, and the manufacturer&rsquo;s own notice is authoritative.
      </p>

      <p>
        <strong className="text-white/90">Modification guidance is not a legality check.</strong>
        Emissions rules, inspection requirements and insurance consequences vary by where you live,
        and Well Kept does not check any of them. Modifying a vehicle may void warranties and may be
        illegal on public roads where you are.
      </p>

      <LegalSection>Your account</LegalSection>

      <p>
        Keep your password to yourself; you are responsible for what happens under your account. Tell
        us if you think someone else has access to it. You can delete your account at any time from
        inside the app or the website.
      </p>

      <LegalSection>What you upload</LegalSection>

      <p>
        Your photographs, invoices and notes stay yours. You give us permission to store and process
        them for the sole purpose of operating Well Kept for you — including sending the relevant
        details to the AI provider described in the Privacy Policy in order to answer your questions.
        We do not use your content to train models, and we do not publish it.
      </p>

      <p>
        Only upload things you have the right to upload.
      </p>

      <LegalSection>Fair use</LegalSection>

      <p>
        Do not attempt to break, overload or reverse-engineer the service, use it to build a
        competing product, or use it for anything unlawful. AI features carry per-account limits so
        that one account cannot exhaust the service for everyone; those limits may change.
      </p>

      <LegalSection>Subscriptions</LegalSection>

      <p>
        Paid subscriptions are sold and billed through the App Store. Payment is taken by Apple when
        you confirm the purchase, and the subscription renews automatically for the same period
        unless you turn renewal off at least 24 hours before it ends.
      </p>

      <p>
        <strong className="text-white/90">You cancel through Apple, not through us</strong> — in{' '}
        {SUBSCRIPTION_CANCEL_PATH}. We cannot cancel it on your behalf, and{' '}
        <strong className="text-white/90">deleting your Well Kept account does not stop the
        billing.</strong> Cancel first, or you will keep being charged after the account is gone.
        Refunds are handled by Apple under their terms.
      </p>

      <LegalSection>Availability</LegalSection>

      <p>
        Well Kept is provided as it is. We do not promise it will always be available, that its
        answers will always be right, or that it will never lose data — though we try hard at all
        three. To the fullest extent the law allows, we are not liable for indirect or consequential
        loss arising from your use of it, and nothing in these terms limits liability that cannot
        legally be limited.
      </p>

      <LegalSection>Ending it</LegalSection>

      <p>
        You can stop using Well Kept and delete your account whenever you like. We may suspend or
        close an account that breaks these terms.
      </p>

      <LegalSection>Changes</LegalSection>

      <p>
        If these terms change in substance, the date at the top changes with them.
      </p>

      <LegalSection>Contact</LegalSection>

      <p>
        <span className="text-white/90">{CONTACT_EMAIL}</span>.
      </p>
    </LegalDocument>
  );
}
