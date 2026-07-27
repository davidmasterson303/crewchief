import { NextRequest, NextResponse } from 'next/server';
import { uploadInvoice } from '@/app/actions';
import { logger } from '@crewchief/core/logger';
import { MAX_FILE_SIZE, ALLOWED_DOCUMENT_TYPES } from '@crewchief/core/validation';
import type { ApiResponse } from '@crewchief/core/types';
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  logger.info('API:UPLOAD_INVOICE', 'Upload request received');

  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, 'upload');
  if (!rateLimit.allowed) {
    logger.warn('API:UPLOAD_INVOICE', 'Rate limit exceeded', { identifier });
    return rateLimitResponse(rateLimit);
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const vehicleId = formData.get('vehicleId') as string;
    const bypassVehicleCheck = formData.get('bypassVehicleCheck') as string;

    logger.debug('API:UPLOAD_INVOICE', 'Parsing form data', {
      hasFile: !!file,
      hasVehicleId: !!vehicleId,
      fileName: file?.name
    });

    if (!file || !vehicleId) {
      logger.warn('API:UPLOAD_INVOICE', 'Missing required fields', {
        hasFile: !!file,
        hasVehicleId: !!vehicleId
      });
      return NextResponse.json(
        { success: false, error: 'Missing file or vehicleId' } as ApiResponse,
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      logger.warn('API:UPLOAD_INVOICE', 'File too large', {
        fileSize: file.size,
        maxSize: MAX_FILE_SIZE
      });
      return NextResponse.json(
        { success: false, error: `File size must be less than ${MAX_FILE_SIZE / 1024 / 1024}MB` } as ApiResponse,
        { status: 400 }
      );
    }

    if (!ALLOWED_DOCUMENT_TYPES.includes(file.type)) {
      logger.warn('API:UPLOAD_INVOICE', 'Invalid file type', {
        fileType: file.type,
        allowedTypes: ALLOWED_DOCUMENT_TYPES
      });
      return NextResponse.json(
        { success: false, error: 'Invalid file type' } as ApiResponse,
        { status: 400 }
      );
    }

    const bypassFlag = bypassVehicleCheck === 'true';
    logger.info('API:UPLOAD_INVOICE', 'Processing file', {
      fileName: file.name,
      fileSize: file.size,
      bypassVehicleCheck: bypassFlag,
      vehicleId
    });

    const uploadFormData = new FormData();
    uploadFormData.append('file', file);
    uploadFormData.append('vehicleId', vehicleId);
    if (bypassFlag) {
      uploadFormData.append('bypassVehicleCheck', 'true');
    }

    const result = await uploadInvoice(uploadFormData);

    if (!result.success) {
      logger.warn('API:UPLOAD_INVOICE', 'Upload failed', {
        error: result.error,
        vehicleId
      });

      if (result.error === 'VEHICLE_MISMATCH') {
        return NextResponse.json({
          success: false,
          error: 'VEHICLE_MISMATCH',
          message: result.message,
          extractedVehicle: result.extractedVehicle,
          expectedVehicle: result.expectedVehicle,
        } as ApiResponse);
      }

      if (result.error === 'NOT_AUTOMOTIVE_INVOICE') {
        return NextResponse.json({
          success: false,
          error: 'NOT_AUTOMOTIVE_INVOICE',
          message: result.message,
        } as ApiResponse);
      }

      let errorMessage = result.error || 'Upload failed';
      let statusCode = 500;

      if (errorMessage.includes('Bucket not found')) {
        errorMessage = 'Storage bucket not configured. Please contact support.';
        statusCode = 503;
      } else if (errorMessage.includes('Failed to upload file')) {
        errorMessage = 'Failed to upload file to storage. Please try again.';
      } else if (errorMessage.includes('Failed to create document record')) {
        errorMessage = 'Failed to save document record. Please try again.';
      }

      return NextResponse.json(
        { success: false, error: errorMessage } as ApiResponse,
        { status: statusCode }
      );
    }

    logger.info('API:UPLOAD_INVOICE', 'Upload successful', {
      itemsExtracted: result.itemsExtracted || 0,
      documentId: result.documentId,
      vehicleId
    });

    return NextResponse.json({
      success: true,
      itemsExtracted: result.itemsExtracted || 0,
      documentId: result.documentId
    } as ApiResponse);
  } catch (error) {
    logger.error('API:UPLOAD_INVOICE', error as Error);
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Upload failed' } as ApiResponse,
      { status: 500 }
    );
  }
}
