import { toast } from 'sonner';

export const ERROR_MESSAGES = {
  VEHICLE_NOT_FOUND: 'Vehicle not found',
  MAINTENANCE_LOAD_FAILED: 'Failed to load maintenance data',
  SERVICE_ITEM_DELETE_FAILED: 'Failed to delete service item',
  SERVICE_ITEM_ADD_FAILED: 'Failed to add service item',
  QUOTE_CREATE_FAILED: 'Failed to create quote',
  DOCUMENT_UPLOAD_FAILED: 'Failed to upload document',
  WISHLIST_UPDATE_FAILED: 'Failed to update wishlist',
  NETWORK_ERROR: 'Network error. Please try again.',
  UNKNOWN_ERROR: 'Something went wrong. Please try again.',
} as const;

export const SUCCESS_MESSAGES = {
  SERVICE_ITEM_DELETED: 'Item deleted successfully',
  SERVICE_ITEM_ADDED: 'Item added successfully',
  QUOTE_CREATED: 'Quote created successfully',
  DOCUMENT_UPLOADED: 'Document uploaded successfully',
  WISHLIST_UPDATED: 'Wishlist updated successfully',
  SAVED: 'Saved successfully',
} as const;

export function showError(message: string, error?: unknown) {
  console.error(message, error);
  toast.error(message);
}

export function showSuccess(message: string) {
  toast.success(message);
}

export function showInfo(message: string) {
  toast.info(message);
}

export function showWarning(message: string) {
  toast.warning(message);
}
