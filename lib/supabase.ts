import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createBrowserClient, createServerClient as ssrCreateServerClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export function hasSupabaseConfig(): boolean {
  return !!(supabaseUrl && supabaseAnonKey);
}

// One client per tab — the previous implementation built a fresh client on
// every call (and the Proxy below invoked it per property access).
let browserClient: SupabaseClient | null = null;

export function createBrowserSupabaseClient(): SupabaseClient {
  if (typeof window === 'undefined') {
    return createClient(supabaseUrl || '', supabaseAnonKey || '', {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }
  if (!browserClient) {
    browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey);
  }
  return browserClient;
}

export function getClientSupabase(): SupabaseClient {
  return createBrowserSupabaseClient();
}

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (createBrowserSupabaseClient() as any)[prop];
  },
});

export function createServerActionClient() {
  const { cookies } = require('next/headers');
  const cookieStore = cookies();
  return ssrCreateServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {}
        },
      },
    }
  );
}

export function getServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(`Missing Supabase environment variables: url=${!!url}, key=${!!key}`);
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function getServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(`Missing Supabase service role environment variables: url=${!!url}, key=${!!serviceRoleKey}`);
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export type Database = {
  vehicles: {
    id: string;
    user_id?: string;
    vin: string;
    year: number;
    make: string;
    model: string;
    trim?: string;
    color?: string;
    image_url?: string;
    current_mileage: number;
    ownership_objective?: string;
    usage_profile?: string;
    avg_miles_per_month?: number;
    performance_mindedness?: 'stock' | 'mild' | 'aggressive';
    driving_style?: string;
    created_at: string;
    updated_at: string;
  };
  vehicle_knowledge_base: {
    id: string;
    vehicle_id: string;
    known_issues: any;
    maintenance_schedule: any;
    fluid_specs: any;
    common_mods: any;
    reliability_score?: number;
    last_research_date: string;
    research_status: 'pending' | 'completed' | 'failed' | 'unsupported';
    created_at: string;
  };
  service_items: {
    id: string;
    vehicle_id: string;
    description: string;
    category: 'maintenance' | 'modification' | 'repair' | 'upgrade';
    status: 'wishlist' | 'purchased' | 'scheduled' | 'completed';
    location_zone?: string;
    estimated_labor_hours: number;
    actual_labor_hours?: number;
    cost_parts: number;
    cost_labor: number;
    date_completed?: string;
    notes?: string;
    created_at: string;
  };
  consultant_conversations: {
    id: string;
    vehicle_id: string;
    message_history: any;
    context_snapshot: any;
    created_at: string;
    updated_at: string;
  };
  labor_bundles: {
    id: string;
    vehicle_id: string;
    service_item_ids: string[];
    bundle_reason?: string;
    labor_saved_hours: number;
    estimated_savings: number;
    status: 'suggested' | 'accepted' | 'rejected' | 'completed';
    suggested_at: string;
  };
  vehicle_documents: {
    id: string;
    vehicle_id: string;
    document_type: 'invoice' | 'manual' | 'photo' | 'report';
    file_url: string;
    extracted_data?: any;
    upload_date: string;
    associated_service_item_id?: string;
  };
  nhtsa_data: {
    id: string;
    vehicle_id: string;
    recalls: any;
    safety_ratings: any;
    specifications: any;
    last_checked: string;
    next_check_due: string;
  };
  location_zones: {
    id: string;
    zone_name: string;
    zone_category?: string;
    typical_access_requirements: string[];
  };
  known_issue_tracking: {
    id: string;
    vehicle_id: string;
    issue_identifier: string;
    status: 'pending' | 'completed' | 'not_interested';
    completed_date?: string;
    notes?: string;
    created_at: string;
    updated_at: string;
  };
  modification_tracking: {
    id: string;
    vehicle_id: string;
    mod_name: string;
    status: 'pending' | 'completed' | 'not_interested';
    installed_date?: string;
    cost_parts: number;
    cost_labor: number;
    notes?: string;
    created_at: string;
    updated_at: string;
  };
  vehicle_health_summary: {
    id: string;
    vehicle_id: string;
    health_score: number;
    summary: string;
    red_flags: string[];
    maintenance_status: string;
    recall_status: string;
    issues_overview: string;
    recommendations: string[];
    last_generated: string;
    created_at: string;
    updated_at: string;
  };
  invoice_line_items: {
    id: string;
    document_id: string;
    vehicle_id: string;
    line_number: number;
    description: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    category: string;
    created_at: string;
  };
};
