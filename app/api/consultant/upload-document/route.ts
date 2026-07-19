import { NextRequest, NextResponse } from 'next/server';
import { uploadConsultantDocument } from '@/app/actions';
import { logger } from '@/lib/logger';
import { MAX_FILE_SIZE, ALLOWED_DOCUMENT_TYPES } from '@/lib/validation';
import type { ApiResponse } from '@/lib/types';
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  logger.info('API:UPLOAD_CONSULTANT_DOC', 'Consultant document upload request received');

  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, 'upload');
  if (!rateLimit.allowed) {
    logger.warn('API:UPLOAD_CONSULTANT_DOC', 'Rate limit exceeded', { identifier });
    return rateLimitResponse(rateLimit);
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const vehicleId = formData.get('vehicleId') as string;
    const sessionId = formData.get('sessionId') as string;

    logger.debug('API:UPLOAD_CONSULTANT_DOC', 'Parsing form data', {
      hasFile: !!file,
      hasVehicleId: !!vehicleId,
      hasSessionId: !!sessionId,
      fileName: file?.name
    });

    if (!file || !vehicleId || !sessionId) {
      logger.warn('API:UPLOAD_CONSULTANT_DOC', 'Missing required fields', {
        hasFile: !!file,
        hasVehicleId: !!vehicleId,
        hasSessionId: !!sessionId
      });
      return NextResponse.json(
        { success: false, error: 'Missing required fields' } as ApiResponse,
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      logger.warn('API:UPLOAD_CONSULTANT_DOC', 'File too large', {
        fileSize: file.size,
        maxSize: MAX_FILE_SIZE
      });
      return NextResponse.json(
        { success: false, error: `File size must be less than ${MAX_FILE_SIZE / 1024 / 1024}MB` } as ApiResponse,
        { status: 400 }
      );
    }

    if (!ALLOWED_DOCUMENT_TYPES.includes(file.type)) {
      logger.warn('API:UPLOAD_CONSULTANT_DOC', 'Invalid file type', {
        fileType: file.type,
        allowedTypes: ALLOWED_DOCUMENT_TYPES
      });
      return NextResponse.json(
        { success: false, error: 'Invalid file type' } as ApiResponse,
        { status: 400 }
      );
    }

    logger.info('API:UPLOAD_CONSULTANT_DOC', 'Processing document', {
      fileName: file.name,
      fileSize: file.size,
      vehicleId,
      sessionId
    });

    const uploadFormData = new FormData();
    uploadFormData.append('file', file);
    uploadFormData.append('vehicleId', vehicleId);
    uploadFormData.append('sessionId', sessionId);

    const result = await uploadConsultantDocument(uploadFormData);

    if (!result.success) {
      logger.warn('API:UPLOAD_CONSULTANT_DOC', 'Upload failed', {
        error: result.error,
        rejected: result.rejected,
        vehicleId,
        sessionId
      });

      if (result.rejected) {
        return NextResponse.json({
          success: false,
          rejected: true,
          reason: result.reason,
        } as ApiResponse);
      }

      return NextResponse.json(
        { success: false, error: result.error || 'Upload failed' } as ApiResponse,
        { status: 500 }
      );
    }

    logger.info('API:UPLOAD_CONSULTANT_DOC', 'Document uploaded successfully', {
      documentId: result.document?.id,
      vehicleId,
      sessionId
    });

    return NextResponse.json({
      success: true,
      document: result.document,
    } as ApiResponse);
  } catch (error) {
    logger.error('API:UPLOAD_CONSULTANT_DOC', error as Error);
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Upload failed' } as ApiResponse,
      { status: 500 }
    );
  }
}
