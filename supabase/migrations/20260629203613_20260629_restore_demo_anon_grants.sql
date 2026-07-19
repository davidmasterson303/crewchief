-- Restore anon SELECT on tables needed by the public /demo page.
-- RLS policies on these tables already restrict anon to is_demo = true rows only,
-- so the table-level grant does not expose authenticated user data.

GRANT SELECT ON public.vehicles               TO anon;
GRANT SELECT ON public.nhtsa_data             TO anon;
GRANT SELECT ON public.vehicle_health_summary TO anon;

-- wishlist_items is also read on the demo dashboard via RLS (is_demo = true guard)
GRANT SELECT ON public.wishlist_items         TO anon;
