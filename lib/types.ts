/**
 * CrewChief - Comprehensive Type Definitions
 *
 * This file contains all TypeScript interfaces and types used throughout the application.
 * Eliminates the use of 'any' and provides strong type safety.
 */

// ============================================================================
// DATABASE ENTITY TYPES
// ============================================================================

export interface Vehicle {
  id: string;
  user_id?: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  vin?: string;
  color?: string;
  mileage?: number;
  preferred_zip_code?: string;
  image_url?: string;
  custom_photo_url?: string;
  performance_goal?: 'mild' | 'moderate' | 'aggressive';
  stock_hp?: number;
  stock_torque?: number;
  stock_zero_to_sixty?: number;
  modified_hp?: number;
  modified_torque?: number;
  modified_zero_to_sixty?: number;
  purchase_price?: number;
  avg_mpg?: number;
  fuel_price_per_gallon?: number;
  insurance_monthly?: number;
  current_mileage?: number;
  avg_miles_per_month?: number;
  focal_point_x?: number;
  focal_point_y?: number;
  vehicle_status?: 'daily_driver' | 'weekend' | 'stored' | 'for_sale';
  is_demo?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ServiceItem {
  id: string;
  vehicle_id: string;
  description: string;
  category: 'maintenance' | 'repair' | 'modification' | 'upgrade';
  status: 'wishlist' | 'scheduled' | 'completed' | 'purchased';
  cost_parts?: number;
  cost_labor?: number;
  date_completed?: string;
  shop_name?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface MaintenanceLineItem {
  id: string;
  vehicle_id: string;
  service_date: string;
  shop_name?: string;
  item_description: string;
  part_number?: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  category?: string;
  invoice_url?: string;
  source_document_id?: string;
  is_combined?: boolean;
  original_category?: 'labor' | 'parts';
  labor_cost?: number;
  parts_cost?: number;
  created_at?: string;
}

export interface InvoiceLineItem {
  id: string;
  vehicle_id: string;
  invoice_id?: string;
  type: 'parts' | 'labor' | 'tax' | 'fee' | 'other';
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  part_number?: string;
  created_at?: string;
}

export interface QuoteRequest {
  id: string;
  vehicle_id: string;
  name?: string;
  selected_items: SelectedItem[];
  zip_code: string;
  additional_notes?: string;
  email_draft: string;
  estimated_total_low: number;
  estimated_total_high: number;
  cost_breakdown: CostEstimate;
  created_at?: string;
}

export interface SelectedItem {
  id: string;
  description: string;
  category: string;
}

export interface CostEstimate {
  items: CostEstimateItem[];
  regional_labor_rate: string;
  total_low: number;
  total_high: number;
}

export interface CostEstimateItem {
  description: string;
  parts_cost_low: number;
  parts_cost_high: number;
  labor_hours_low: number;
  labor_hours_high: number;
  labor_cost_low: number;
  labor_cost_high: number;
  notes: string;
}

export interface ConsultantMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export interface ConsultantSession {
  id: string;
  vehicle_id: string;
  title?: string;
  message_history: ConsultantMessage[];
  created_at?: string;
  updated_at?: string;
}

export interface ConsultantDocument {
  id: string;
  vehicle_id: string;
  session_id?: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  uploaded_at?: string;
}

export interface ModificationDetails {
  id: string;
  vehicle_id: string;
  modification_name: string;
  description?: string;
  estimated_cost?: string;
  difficulty?: string;
  hp_gain?: string;
  torque_gain?: string;
  pros?: string[];
  cons?: string[];
  created_at?: string;
}

export interface IssueTracking {
  id: string;
  vehicle_id: string;
  issue_identifier: string;
  status: 'identified' | 'monitoring' | 'scheduled' | 'completed';
  description?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  created_at?: string;
  updated_at?: string;
}

// ============================================================================
// KNOWLEDGE BASE TYPES
// ============================================================================

export interface KnowledgeBase {
  common_issues?: CommonIssue[];
  known_issues?: KnownIssue[];
  maintenance_schedule?: MaintenanceScheduleItem[];
  modifications?: ModificationSuggestion[];
  recalls?: Recall[];
  reliability_rating?: string;
  owner_satisfaction?: string;
  typical_problems?: string[];
}

export interface CommonIssue {
  part: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  mileage_range?: string;
  typical_cost?: string;
}

export interface KnownIssue {
  part: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  mileage_range?: string;
  fix?: string;
}

export interface MaintenanceScheduleItem {
  service: string;
  interval_miles: number;
  interval_months?: number;
  description?: string;
  estimated_cost?: string;
}

export interface ModificationSuggestion {
  name: string;
  description?: string;
  category?: string;
  estimated_cost?: string;
  difficulty?: string;
  performance_impact?: string;
}

export interface Recall {
  id?: string;
  campaign_number?: string;
  summary?: string;
  description?: string;
  consequence?: string;
  remedy?: string;
  date?: string;
  component?: string;
}

// ============================================================================
// INVOICE PROCESSING TYPES
// ============================================================================

export interface InvoiceData {
  shop_name: string;
  service_date: string;
  mileage?: number;
  total_cost: number;
  items: InvoiceItem[];
  tax_amount?: number;
  notes?: string;
}

export interface InvoiceItem {
  type: 'parts' | 'labor' | 'tax' | 'fee' | 'other';
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  part_number?: string;
  labor_hours?: number;
}

export interface ProcessedInvoice extends InvoiceData {
  vehicle_id: string;
  combined_items: InvoiceItem[];
}

// ============================================================================
// AI CONSULTANT TYPES
// ============================================================================

export interface ConsultantContext {
  messageHistory: ConsultantMessage[];
  vehicle: Vehicle;
  knowledge: KnowledgeBase;
  wishlistItems: ServiceItem[];
  allServiceItems: ServiceItem[];
  completedItems: ServiceItem[];
  maintenanceLineItems: MaintenanceLineItem[];
  documents: ConsultantDocument[];
  issueTracking: IssueTracking[];
  attachedDocuments?: AttachedDocument[];
}

export interface AttachedDocument {
  file_name: string;
  file_type: string;
  extracted_text?: string;
}

export interface GeneratedResponse {
  text: string;
  confidence?: number;
  sources?: string[];
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface ApiError {
  message: string;
  code?: string;
  details?: Record<string, unknown>;
  status?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ============================================================================
// FORM DATA TYPES
// ============================================================================

export interface VehicleFormData {
  year: number;
  make: string;
  model: string;
  trim?: string;
  vin?: string;
  mileage?: number;
  color?: string;
}

export interface ServiceItemFormData {
  description: string;
  category: ServiceItem['category'];
  status: ServiceItem['status'];
  cost_parts?: number;
  cost_labor?: number;
  notes?: string;
}

export interface QuoteRequestFormData {
  selected_item_ids: string[];
  zip_code: string;
  additional_notes?: string;
  quote_name?: string;
}

export interface MaintenanceItemFormData {
  item_description: string;
  category?: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  part_number?: string;
  service_date: string;
  shop_name?: string;
}

// ============================================================================
// COMPONENT PROP TYPES
// ============================================================================

export interface DashboardProps {
  vehicleId: string;
  vehicle: Vehicle;
  knowledge: KnowledgeBase;
  serviceItems: ServiceItem[];
  maintenanceHistory: MaintenanceLineItem[];
}

export interface ServiceItemsProps {
  vehicleId: string;
  vehicle: Vehicle;
  initialItems: ServiceItem[];
  bundles: ServiceBundle[];
  savedItemNames?: Set<string>;
}

export interface ServiceBundle {
  id: string;
  items: ServiceItem[];
  bundle_reason: string;
  labor_saved_hours: number;
  estimated_savings: number;
}

export interface QuoteRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicle: Vehicle;
  wishlistItems: ServiceItem[];
  onQuoteSaved?: (quoteRequestId: string) => void;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export type PerformanceGoal = 'mild' | 'moderate' | 'aggressive';

export type ServiceStatus = 'wishlist' | 'scheduled' | 'completed' | 'purchased';

export type ServiceCategory = 'maintenance' | 'repair' | 'modification' | 'upgrade';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type ItemType = 'parts' | 'labor' | 'tax' | 'fee' | 'other';

// ============================================================================
// VALIDATION RESULT TYPES
// ============================================================================

export interface ValidationResult<T = unknown> {
  valid: boolean;
  data?: T;
  errors?: ValidationError[];
}

export interface ValidationError {
  field: string;
  message: string;
  code?: string;
}

// ============================================================================
// PERFORMANCE TRACKING TYPES
// ============================================================================

export interface PerformanceStats {
  stock_hp?: number;
  stock_torque?: number;
  stock_zero_to_sixty?: number;
  modified_hp?: number;
  modified_torque?: number;
  modified_zero_to_sixty?: number;
  modifications_count?: number;
}

export interface ModificationImpact {
  hp_gain?: string;
  torque_gain?: string;
  zero_to_sixty_improvement?: string;
  pros?: string[];
  cons?: string[];
}

// ============================================================================
// FILE UPLOAD TYPES
// ============================================================================

export interface UploadedFile {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  uploaded_at: string;
}

export interface FileUploadResult {
  success: boolean;
  file?: UploadedFile;
  error?: string;
}

// ============================================================================
// QUOTE GENERATION TYPES
// ============================================================================

export interface QuoteRequestData {
  quoteRequestId: string;
  emailDraft: string;
  costBreakdown: CostEstimate;
}

export interface QuoteHistoryItem extends QuoteRequest {
  created_at: string;
}

// ============================================================================
// POWERTRAIN CLARIFICATION TYPES
// ============================================================================

export interface PowertrainFieldUncertainty {
  isUncertain: boolean;
  rawValue?: string;
  options?: string[];
}

export interface PowertrainUncertainty {
  hasUncertainty: boolean;
  uncertainFields: {
    engine?: PowertrainFieldUncertainty;
    transmission?: PowertrainFieldUncertainty;
    drivetrain?: PowertrainFieldUncertainty;
  };
  rawValues: {
    engine: string | null;
    transmission: string | null;
    drivetrain: string | null;
  };
}

// ============================================================================
// CACHE TYPES
// ============================================================================

export interface CachedItem<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

export interface CacheOptions {
  ttl?: number; // Time to live in milliseconds
  key: string;
}

// ============================================================================
// HEALTH CHECK TYPES
// ============================================================================

export interface HealthSummary {
  overall_health: 'excellent' | 'good' | 'fair' | 'poor';
  active_issues_count: number;
  completed_maintenance_count: number;
  pending_maintenance_count: number;
  next_service_due?: string;
  critical_issues?: string[];
}

// ============================================================================
// MAINTENANCE HISTORY TYPES
// ============================================================================

export interface MaintenanceRecord {
  id: string;
  _type: 'maintenance_line_item' | 'service_item';
  display_description: string;
  display_date: string | null;
  display_cost: number;
  display_shop: string | null;
  source_document_id?: string;
  is_combined?: boolean;
  original_category?: 'labor' | 'parts';
  category?: string;
  part_number?: string;
  quantity?: number;
  unit_cost?: number;
  labor_cost?: number;
  parts_cost?: number;
  total_cost?: number;
  created_at?: string;
  item_description?: string;
  service_date?: string;
  shop_name?: string;
  invoice_url?: string;
  description?: string;
  date_completed?: string;
  notes?: string;
  cost_parts?: number;
  cost_labor?: number;
}

export interface MaintenanceItemToDelete {
  id: string;
  sourceDocId?: string;
  description: string;
}

export interface DeleteMaintenanceItemResult {
  success: boolean;
  error?: string;
}

export interface MaintenanceItemDetails {
  id: string;
  description: string;
  date_completed: string;
  shop_name?: string;
  cost_labor?: number;
  cost_parts?: number;
  total_cost?: number;
  part_number?: string;
  quantity?: number;
  unit_cost?: number;
  is_combined?: boolean;
  category?: string;
  notes?: string;
  location_zone?: string;
  invoice_url?: string;
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isVehicle(obj: unknown): obj is Vehicle {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'id' in obj &&
    'year' in obj &&
    'make' in obj &&
    'model' in obj
  );
}

export function isServiceItem(obj: unknown): obj is ServiceItem {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'id' in obj &&
    'vehicle_id' in obj &&
    'description' in obj &&
    'category' in obj &&
    'status' in obj
  );
}

export function isApiResponse<T>(obj: unknown): obj is ApiResponse<T> {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'success' in obj &&
    typeof (obj as ApiResponse).success === 'boolean'
  );
}
