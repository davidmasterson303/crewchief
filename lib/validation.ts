/**
 * CrewChief - Comprehensive Validation Schemas
 *
 * Uses Zod for runtime validation of all user inputs, API requests,
 * and database operations. Provides type-safe validation with clear error messages.
 *
 * Usage:
 *   import { validateData, vehicleSchema } from '@/lib/validation';
 *
 *   const result = validateData(vehicleSchema, userInput);
 *   if (!result.success) {
 *     console.error(result.error);
 *     return;
 *   }
 *   // result.data is now type-safe
 */

import { z } from 'zod';
import type { ApiResponse } from '@/lib/types';
import { logger } from '@/lib/logger';

// ============================================================================
// CONSTANTS
// ============================================================================

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
export const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  ...ALLOWED_IMAGE_TYPES,
];

export const CURRENT_YEAR = new Date().getFullYear();
export const MIN_YEAR = 1900;
export const MAX_YEAR = CURRENT_YEAR + 2; // Allow next year's models

// ============================================================================
// VEHICLE SCHEMAS
// ============================================================================

export const vehicleSchema = z.object({
  year: z
    .number()
    .int('Year must be a whole number')
    .min(MIN_YEAR, `Year must be ${MIN_YEAR} or later`)
    .max(MAX_YEAR, `Year must be ${MAX_YEAR} or earlier`),
  make: z
    .string()
    .min(1, 'Make is required')
    .max(50, 'Make must be 50 characters or less')
    .trim(),
  model: z
    .string()
    .min(1, 'Model is required')
    .max(50, 'Model must be 50 characters or less')
    .trim(),
  trim: z
    .string()
    .max(50, 'Trim must be 50 characters or less')
    .trim()
    .optional()
    .or(z.literal('')),
  vin: z
    .string()
    .length(17, 'VIN must be exactly 17 characters')
    .regex(/^[A-HJ-NPR-Z0-9]{17}$/, 'Invalid VIN format')
    .optional()
    .or(z.literal('')),
  mileage: z
    .number()
    .int('Mileage must be a whole number')
    .min(0, 'Mileage cannot be negative')
    .max(1000000, 'Mileage seems unusually high')
    .optional(),
  color: z
    .string()
    .max(30, 'Color must be 30 characters or less')
    .trim()
    .optional()
    .or(z.literal('')),
  preferred_zip_code: z
    .string()
    .regex(/^\d{5}$/, 'Zip code must be 5 digits')
    .optional()
    .or(z.literal('')),
});

export const vehicleIdSchema = z.string().uuid('Invalid vehicle ID format');

export const vehicleUpdateSchema = vehicleSchema.partial();

// ============================================================================
// SERVICE ITEM SCHEMAS
// ============================================================================

export const serviceItemSchema = z.object({
  vehicle_id: vehicleIdSchema,
  description: z
    .string()
    .min(1, 'Description is required')
    .max(500, 'Description must be 500 characters or less')
    .trim(),
  category: z.enum(['maintenance', 'repair', 'modification', 'upgrade'], {
    errorMap: () => ({ message: 'Invalid category' }),
  }),
  status: z.enum(['wishlist', 'scheduled', 'completed', 'purchased'], {
    errorMap: () => ({ message: 'Invalid status' }),
  }),
  cost_parts: z
    .number()
    .min(0, 'Parts cost cannot be negative')
    .max(1000000, 'Parts cost seems unusually high')
    .optional(),
  cost_labor: z
    .number()
    .min(0, 'Labor cost cannot be negative')
    .max(1000000, 'Labor cost seems unusually high')
    .optional(),
  notes: z
    .string()
    .max(1000, 'Notes must be 1000 characters or less')
    .trim()
    .optional()
    .or(z.literal('')),
});

export const serviceItemUpdateSchema = serviceItemSchema
  .omit({ vehicle_id: true })
  .partial();

// ============================================================================
// MAINTENANCE LINE ITEM SCHEMAS
// ============================================================================

export const maintenanceLineItemSchema = z.object({
  vehicle_id: vehicleIdSchema,
  type: z.enum(['parts', 'labor', 'tax', 'fee', 'other'], {
    errorMap: () => ({ message: 'Invalid item type' }),
  }),
  description: z
    .string()
    .min(1, 'Description is required')
    .max(500, 'Description must be 500 characters or less')
    .trim(),
  quantity: z
    .number()
    .min(0, 'Quantity cannot be negative')
    .max(1000, 'Quantity seems unusually high'),
  unit_price: z
    .number()
    .min(0, 'Unit price cannot be negative')
    .max(100000, 'Unit price seems unusually high'),
  total_price: z
    .number()
    .min(0, 'Total price cannot be negative')
    .max(1000000, 'Total price seems unusually high'),
  part_number: z
    .string()
    .max(100, 'Part number must be 100 characters or less')
    .trim()
    .optional()
    .or(z.literal('')),
  notes: z
    .string()
    .max(1000, 'Notes must be 1000 characters or less')
    .trim()
    .optional()
    .or(z.literal('')),
  service_date: z.string().datetime('Invalid date format'),
  mileage: z
    .number()
    .int('Mileage must be a whole number')
    .min(0, 'Mileage cannot be negative')
    .max(1000000, 'Mileage seems unusually high')
    .optional(),
  shop_name: z
    .string()
    .max(200, 'Shop name must be 200 characters or less')
    .trim()
    .optional()
    .or(z.literal('')),
});

// ============================================================================
// QUOTE REQUEST SCHEMAS
// ============================================================================

export const zipCodeSchema = z
  .string()
  .regex(/^\d{5}$/, 'Zip code must be exactly 5 digits');

export const quoteRequestSchema = z.object({
  vehicle_id: vehicleIdSchema,
  selected_item_ids: z
    .array(z.string().uuid('Invalid item ID format'))
    .min(1, 'At least one item must be selected')
    .max(50, 'Too many items selected'),
  zip_code: zipCodeSchema,
  additional_notes: z
    .string()
    .max(2000, 'Notes must be 2000 characters or less')
    .trim()
    .optional()
    .or(z.literal('')),
  quote_name: z
    .string()
    .max(100, 'Quote name must be 100 characters or less')
    .trim()
    .optional()
    .or(z.literal('')),
});

// ============================================================================
// FILE UPLOAD SCHEMAS
// ============================================================================

export const fileUploadSchema = z.object({
  file: z.custom<File>((file) => {
    if (!(file instanceof File)) {
      return false;
    }
    return true;
  }, 'Invalid file'),
});

export function validateFileUpload(file: File): ApiResponse<File> {
  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      success: false,
      error: `File size must be less than ${MAX_FILE_SIZE / 1024 / 1024}MB`,
    };
  }

  // Check file type
  if (!ALLOWED_DOCUMENT_TYPES.includes(file.type)) {
    return {
      success: false,
      error: `File type must be one of: ${ALLOWED_DOCUMENT_TYPES.join(', ')}`,
    };
  }

  // Check filename (prevent path traversal)
  const filename = file.name;
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return {
      success: false,
      error: 'Invalid filename',
    };
  }

  return { success: true, data: file };
}

// ============================================================================
// CONSULTANT SCHEMAS
// ============================================================================

export const consultantMessageSchema = z.object({
  content: z
    .string()
    .min(1, 'Message cannot be empty')
    .max(5000, 'Message must be 5000 characters or less')
    .trim(),
  attachments: z
    .array(
      z.object({
        file_name: z.string(),
        file_type: z.string(),
        file_path: z.string(),
      })
    )
    .optional(),
});

// ============================================================================
// MODIFICATION SCHEMAS
// ============================================================================

export const modificationNameSchema = z
  .string()
  .min(1, 'Modification name is required')
  .max(200, 'Modification name must be 200 characters or less')
  .trim();

export const performanceGoalSchema = z.enum(['mild', 'moderate', 'aggressive'], {
  errorMap: () => ({ message: 'Invalid performance goal' }),
});

// ============================================================================
// ISSUE TRACKING SCHEMAS
// ============================================================================

export const issueNameSchema = z
  .string()
  .min(1, 'Issue name is required')
  .max(200, 'Issue name must be 200 characters or less')
  .trim();

export const issueStatusSchema = z.enum(
  ['identified', 'monitoring', 'scheduled', 'completed'],
  {
    errorMap: () => ({ message: 'Invalid issue status' }),
  }
);

// ============================================================================
// VALIDATION HELPER FUNCTIONS
// ============================================================================

/**
 * Validate data against a Zod schema and return ApiResponse
 */
export function validateData<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context?: string
): ApiResponse<T> {
  try {
    const validated = schema.parse(data);
    if (context) {
      logger.debug(`VALIDATE:${context}`, 'Validation passed');
    }
    return { success: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.errors
        .map((e) => {
          const path = e.path.join('.');
          return path ? `${path}: ${e.message}` : e.message;
        })
        .join('; ');

      if (context) {
        logger.warn(`VALIDATE:${context}`, 'Validation failed', {
          errors: error.errors,
        });
      }

      return {
        success: false,
        error: errorMessage,
      };
    }

    if (context) {
      logger.error(`VALIDATE:${context}`, error as Error);
    }

    return { success: false, error: 'Validation failed' };
  }
}

/**
 * Validate data and throw if invalid (for use in try-catch blocks)
 */
export function validateOrThrow<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context?: string
): T {
  const result = validateData(schema, data, context);
  if (!result.success) {
    throw new Error(result.error);
  }
  return result.data!;
}

/**
 * Sanitize string input (prevent XSS)
 */
export function sanitizeString(input: string): string {
  return input
    .replace(/[<>]/g, '') // Remove < and >
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .trim();
}

/**
 * Validate and sanitize user input
 */
export function validateAndSanitizeString(
  input: string,
  maxLength: number = 1000
): ApiResponse<string> {
  if (typeof input !== 'string') {
    return { success: false, error: 'Input must be a string' };
  }

  if (input.length > maxLength) {
    return {
      success: false,
      error: `Input must be ${maxLength} characters or less`,
    };
  }

  const sanitized = sanitizeString(input);
  return { success: true, data: sanitized };
}

/**
 * Check if a string is a valid UUID
 */
export function isValidUUID(id: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/**
 * Validate email format (basic check)
 */
export const emailSchema = z.string().email('Invalid email format');

/**
 * Validate URL format
 */
export const urlSchema = z.string().url('Invalid URL format');

/**
 * Validate positive integer
 */
export const positiveIntSchema = z
  .number()
  .int('Must be a whole number')
  .positive('Must be greater than zero');

/**
 * Validate non-negative integer
 */
export const nonNegativeIntSchema = z
  .number()
  .int('Must be a whole number')
  .nonnegative('Cannot be negative');

// ============================================================================
// BATCH VALIDATION
// ============================================================================

/**
 * Validate an array of items against a schema
 * Returns partial results with errors for invalid items
 */
export function validateBatch<T>(
  schema: z.ZodSchema<T>,
  items: unknown[],
  context?: string
): {
  success: boolean;
  validItems: T[];
  errors: Array<{ index: number; error: string }>;
} {
  const validItems: T[] = [];
  const errors: Array<{ index: number; error: string }> = [];

  items.forEach((item, index) => {
    const result = validateData(schema, item, context);
    if (result.success && result.data) {
      validItems.push(result.data);
    } else {
      errors.push({ index, error: result.error || 'Unknown error' });
    }
  });

  return {
    success: errors.length === 0,
    validItems,
    errors,
  };
}

// Export all schemas for use in other modules
export const schemas = {
  vehicle: vehicleSchema,
  vehicleUpdate: vehicleUpdateSchema,
  serviceItem: serviceItemSchema,
  serviceItemUpdate: serviceItemUpdateSchema,
  maintenanceLineItem: maintenanceLineItemSchema,
  quoteRequest: quoteRequestSchema,
  zipCode: zipCodeSchema,
  consultantMessage: consultantMessageSchema,
  modificationName: modificationNameSchema,
  performanceGoal: performanceGoalSchema,
  issueName: issueNameSchema,
  issueStatus: issueStatusSchema,
  email: emailSchema,
  url: urlSchema,
  positiveInt: positiveIntSchema,
  nonNegativeInt: nonNegativeIntSchema,
};
