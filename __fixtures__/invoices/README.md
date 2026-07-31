# Invoice fixtures — the vision regression corpus

Test invoices for `parseInvoiceLineItems`, `uploadInvoiceToMaintenanceItems` and
`validateConsultantDocument`.

## Why this exists

Invoice extraction is the one path in this app whose regressions are **invisible**. A model that
reads fewer line items, or misreads a price, still returns well-formed JSON. It passes the
typecheck, the test suite, the demo contract and the promote gate. Nothing goes red. The feature
just quietly gets worse.

That became concrete on 30 Jul 2026, when the vision model moved from `gemini-2.5-flash` to
`gemini-3.6-flash` and there was no way to tell whether extraction had improved, held, or degraded.
See `TICKET_gemini_model_tiering_2026-07-30.md`.

A corpus with **known correct answers** is the only thing that turns "the model changed" into a
measurable claim.

## THIS REPOSITORY IS PUBLIC

Anything committed here is published to the internet, permanently, and is in the git history even if
deleted later.

**Only synthetic or sample invoices.** No real customer invoices, no real names, addresses, phone
numbers, VINs, licence plates, account numbers or card details — including in EXIF metadata.

If a fixture came from the internet, it must be a published sample or template, not a real
document somebody uploaded by accident. When in doubt, leave it out and generate one instead.

## Layout

```
__fixtures__/invoices/
  manifest.json          ground truth — what each fixture SHOULD extract to
  01-clean-scan.pdf
  02-phone-photo-angled.jpg
  ...
```

Naming follows the `owner-photos` convention already in this directory's parent:
`NN-short-description.ext`, numbered so the set has a stable order.

## The corpus should cover, not just include

One clean invoice proves almost nothing — every model reads a clean invoice. The value is in the
awkward cases, because those are where models differ:

| # | Case | Why it earns its place |
|---|---|---|
| 1 | Clean digital scan, itemised | The baseline. If this fails, something is badly wrong |
| 2 | Phone photo at an angle, slight blur | How a real user actually captures one |
| 3 | Faded thermal receipt | Common at independent shops, low contrast |
| 4 | Multi-page invoice | Does it read past page one, or silently stop |
| 5 | Handwritten additions on a printed form | Very common in small garages |
| 6 | Parts and labour split into separate sections | Tests structure, not just OCR |
| 7 | Line items with discounts or credits | Negative numbers are quietly mishandled |
| 8 | **A non-automotive invoice** (control) | `validateConsultantDocument` must REJECT this. A corpus with no negative case cannot detect a validator that says yes to everything |

## manifest.json

Each entry pairs a file with what a correct extraction produces. Ground truth is established by a
human reading the invoice — never by recording what the model happened to return, which would
enshrine today's errors as the standard.

Partial ground truth is fine and better than none: `expectTotal` alone still catches a model that
drops half the line items.

## Running it

There is no automated runner yet — see the ticket. Until there is, the corpus is exercised by hand
against a deployment, and `manifest.json` is what you check the results against.

**Known blocker as of 30 Jul 2026:** invoice upload on the deployed app fails with
`Invalid API key` — the service-role credential is stale on the deployment. Extraction cannot be
tested end to end until that is fixed. That failure is a credential problem, not a vision problem;
do not record it as an extraction result.
