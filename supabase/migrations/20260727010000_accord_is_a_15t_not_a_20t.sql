/*
  # The demo Accord is a 1.5T, not a 2.0T

  The consultant told a reader the Accord's "CVT fluid is screaming for
  attention." A 2018 Accord **2.0T** has a 10-speed automatic; the **1.5T** is
  the CVT car. The consultant was not hallucinating — it was faithfully
  reporting seed data that says this car has a CVT.

  ## Which half was wrong

  Every substantive field describes a 1.5T. Only the trim string disagreed:

    - `stock_hp` 192 / `stock_torque` 192 are the 1.5T's figures exactly.
      The 2.0T is 252 hp / 273 lb-ft.
    - `transmission_type` is 'CVT', which is the 1.5T's gearbox.
    - The seeded known issue is oil dilution, which is the 1.5T turbo's
      documented defect and not the 2.0T's.
    - Even the synthetic VIN embeds `1HGCV1F3`, and `CV1` is the 1.5L car.

  The other two demo vehicles' output figures are correct — WRX 268/258, M3
  Competition 444/406 — so this was not sloppy seed data in general. It was one
  vehicle authored as a 1.5T and labelled `Sport 2.0T`.

  So this migration corrects the badge and the handful of labels that followed
  it, rather than rewriting the transmission, the maintenance schedule, the four
  known issues and five prose fields of the health summary to suit a 2.0T. That
  alternative would have meant inventing 2.0T issues to replace two real,
  well-documented 1.5T ones — more change, and new opportunities to be
  confidently wrong.

  `Sport` was a real 2018 trim in both engines, so the label stays plausible.

  ## Deliberately unchanged

  Everything about the CVT — `transmission_type`, the "10th Gen CVT
  Transmission" known issue, the CVT fluid flush in the maintenance schedule,
  the CVT service and wishlist items, and all five CVT mentions in the health
  summary prose. On a 1.5T all of it is **correct**, which is the whole point of
  fixing this end rather than the other.

  `stock_hp` and `stock_torque` also stay at 192/192 — already right.

  ## Not fixed here

  The Accord photograph is an 8th-generation car (2008–2012). That is a separate
  problem recorded in CREWCHIEF_STATUS.md §20, and this vehicle still has a
  wrong-generation photo after this migration. Correcting the badge does not
  correct the picture.

  ## Idempotent

  Every statement is a targeted replace guarded on `is_demo`/vehicle id.
  Re-running finds nothing left to change.
*/

DO $$
DECLARE
  v1_id uuid := 'a1000000-0000-0000-0000-000000000001'::uuid;
BEGIN

  -- 1. The badge itself, and the one output figure that fitted the 2.0T.
  --    0-60 of 6.2s is a 2.0T time; the 1.5T is around 7.2s.
  UPDATE vehicles
     SET trim = 'Sport 1.5T',
         stock_zero_to_sixty = 7.2
   WHERE id = v1_id AND is_demo = true;

  -- 2. Knowledge base: the oil-dilution issue is the 1.5T's, and the
  --    "shares its engine with the Civic Type R" fact is 2.0T-only, so it is
  --    replaced rather than relabelled.
  UPDATE vehicle_knowledge_base
     SET known_issues = replace(
           replace(known_issues::text, 'Oil Dilution (2.0T)', 'Oil Dilution (1.5T)'),
           'the 2.0T engine', 'the 1.5T engine')::jsonb
   WHERE vehicle_id = v1_id;

  UPDATE vehicle_knowledge_base
     SET interesting_facts = array_replace(
           interesting_facts,
           'The 2.0T Sport shares its engine with the Civic Type R, detuned for comfort.',
           'The 2018 Accord Sport was one of the last midsize sedans you could still order with a manual gearbox — the 1.5T offered a 6-speed.'
         )
   WHERE vehicle_id = v1_id;

  -- 3. Tracked issue label.
  UPDATE known_issue_tracking
     SET issue_identifier = 'Oil dilution (1.5T)'
   WHERE vehicle_id = v1_id AND issue_identifier = 'Oil dilution (2.0T)';

  -- 4. Wishlist row. The identifier must stay in the canonical
  --    `${itemType}:${slug}` form produced by lib/wishlist-identifier.ts —
  --    "Oil Dilution (1.5T)" normalises to oil_dilution_1_5t. If these two
  --    drift apart the item reads as absent from one surface and duplicates on
  --    the next, which is the §11 bug.
  UPDATE wishlist_items
     SET item_name = 'Oil Dilution (1.5T)',
         item_identifier = 'issue:oil_dilution_1_5t'
   WHERE vehicle_id = v1_id AND item_identifier = 'issue:oil_dilution_2_0t';

  -- 5. The seeded demo conversation asserts "2.0T" twice while recommending a
  --    CVT flush in the same breath — the contradiction in one paragraph.
  UPDATE consultant_conversations
     SET message_history = replace(
           replace(message_history::text, '2018 Accord 2.0T', '2018 Accord 1.5T'),
           'The 2.0T has a documented fuel dilution issue', 'The 1.5T has a documented fuel dilution issue')::jsonb
   WHERE vehicle_id = v1_id;

END $$;
