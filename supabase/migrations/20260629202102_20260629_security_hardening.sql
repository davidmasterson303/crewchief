-- 1. Fix mutable search_path on all 4 functions

ALTER FUNCTION public.cleanup_duplicate_maintenance_items()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.delete_maintenance_items_for_document(doc_id uuid)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.update_wishlist_items_updated_at()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.user_owns_vehicle(vid uuid)
  SET search_path = public, pg_temp;

-- 2. Switch user_owns_vehicle to SECURITY INVOKER and restrict EXECUTE
ALTER FUNCTION public.user_owns_vehicle(vid uuid) SECURITY INVOKER;

REVOKE EXECUTE ON FUNCTION public.user_owns_vehicle(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_owns_vehicle(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.user_owns_vehicle(uuid) TO authenticated;

-- 3. Revoke anon SELECT from all user-data tables
REVOKE SELECT ON public.api_rate_limits            FROM anon;
REVOKE SELECT ON public.consultant_conversations   FROM anon;
REVOKE SELECT ON public.consultant_documents       FROM anon;
REVOKE SELECT ON public.invoice_line_items         FROM anon;
REVOKE SELECT ON public.known_issue_tracking       FROM anon;
REVOKE SELECT ON public.labor_bundles              FROM anon;
REVOKE SELECT ON public.location_zones             FROM anon;
REVOKE SELECT ON public.maintenance_dismissals     FROM anon;
REVOKE SELECT ON public.maintenance_line_items     FROM anon;
REVOKE SELECT ON public.mod_detail_queue           FROM anon;
REVOKE SELECT ON public.mod_names_cache            FROM anon;
REVOKE SELECT ON public.modification_details       FROM anon;
REVOKE SELECT ON public.modification_tracking      FROM anon;
REVOKE SELECT ON public.nhtsa_data                 FROM anon;
REVOKE SELECT ON public.performance_mod_cache      FROM anon;
REVOKE SELECT ON public.quote_requests             FROM anon;
REVOKE SELECT ON public.recall_actions             FROM anon;
REVOKE SELECT ON public.service_items              FROM anon;
REVOKE SELECT ON public.tier_backfill_queue        FROM anon;
REVOKE SELECT ON public.vehicle_documents          FROM anon;
REVOKE SELECT ON public.vehicle_health_history     FROM anon;
REVOKE SELECT ON public.vehicle_health_summary     FROM anon;
REVOKE SELECT ON public.vehicle_knowledge_base     FROM anon;
REVOKE SELECT ON public.vehicles                   FROM anon;
REVOKE SELECT ON public.wishlist_items             FROM anon;

-- 4. Revoke authenticated SELECT from internal plumbing tables that should
--    not be queryable directly through GraphQL/PostgREST
REVOKE SELECT ON public.api_rate_limits        FROM authenticated;
REVOKE SELECT ON public.mod_detail_queue       FROM authenticated;
REVOKE SELECT ON public.mod_names_cache        FROM authenticated;
REVOKE SELECT ON public.performance_mod_cache  FROM authenticated;
REVOKE SELECT ON public.tier_backfill_queue    FROM authenticated;
