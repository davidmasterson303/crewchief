import { NextRequest } from 'next/server';
import { logger } from '@wellkept/core/logger';
import type { ApiResponse } from '@wellkept/core/types';
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rate-limit';
import { requireCaller } from '@/lib/api-auth';
import { getServiceRoleClient } from '@/lib/supabase';
import { isExpoPushToken } from '@wellkept/core/push-tokens';

export const dynamic = 'force-dynamic';

/**
 * Where to send this account's notifications.
 *
 * Phase 5's server half begins here. The device side shipped 5 Aug and can do
 * nothing without somewhere to record a delivery address.
 *
 * ── Why this is a route and not a server action ─────────────────────────────
 *
 * Same reason `/api/v1/consultant` and `/api/v1/account` are routes: a React
 * Native client cannot call a Next server action. Phase 3.0 established the
 * pattern and this follows it rather than inventing a second one.
 *
 * ── Why it authorizes with `requireCaller` and not `authorizeVehicleAccess` ─
 *
 * A push token belongs to an **account**, not a vehicle. Reaching for the
 * vehicle-scoped helper would mean inventing a vehicle for a request that has
 * none — the posture note `/api/v1/vehicles` carries about being `'session'`
 * rather than `'vehicle-scoped'` applies here for the same reason.
 *
 * ── The token is validated for shape, and that is not theatre ───────────────
 *
 * Anything stored here is later handed to Expo's push service. A row holding a
 * value that is not a push token is a send that fails once per notification,
 * forever, for a device that will never receive one — and the failure surfaces
 * far from the request that caused it. Refusing at the boundary keeps the
 * diagnosis local.
 */

interface RegisterBody {
  expoPushToken?: unknown;
  deviceId?: unknown;
  platform?: unknown;
}

export async function POST(request: NextRequest): Promise<Response> {
  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, 'default');
  if (!rateLimit.allowed) {
    logger.warn('API:PUSH_TOKEN', 'Rate limit exceeded', { identifier });
    return rateLimitResponse(rateLimit);
  }

  let body: RegisterBody;
  try {
    body = (await request.json()) as RegisterBody;
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON body' } as ApiResponse, {
      status: 400,
    });
  }

  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const expoPushToken = typeof body.expoPushToken === 'string' ? body.expoPushToken.trim() : '';
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
  const platform = body.platform === 'android' ? 'android' : 'ios';

  if (!isExpoPushToken(expoPushToken)) {
    // Refused rather than stored. See the header: a malformed row fails once
    // per notification, forever, far from here.
    return Response.json(
      { success: false, error: 'Not an Expo push token' } as ApiResponse,
      { status: 400 }
    );
  }

  if (!deviceId) {
    return Response.json({ success: false, error: 'Missing deviceId' } as ApiResponse, {
      status: 400,
    });
  }

  try {
    const client = getServiceRoleClient();

    /*
      Upsert on `(user_id, device_id)`, which the migration names explicitly as
      `device_push_tokens_one_per_device`. Expo tokens rotate on reinstall and
      on restore to a new handset, so a device re-registering must *replace*
      its address rather than add one — accumulating rows is how a fan-out
      starts pushing to phones that were traded in.

      `last_registered_at` is touched every time, not only on change: it is the
      only signal for retiring a device that stopped opening the app.
    */
    const { error } = await client
      .from('device_push_tokens')
      .upsert(
        {
          user_id: caller.userId,
          expo_push_token: expoPushToken,
          device_id: deviceId,
          platform,
          last_registered_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,device_id' }
      );

    if (error) {
      logger.error('API:PUSH_TOKEN', new Error(error.message), { userId: caller.userId });
      return Response.json(
        { success: false, error: 'Could not register for notifications' } as ApiResponse,
        { status: 500 }
      );
    }

    logger.info('API:PUSH_TOKEN', 'Device registered', { userId: caller.userId, platform });
    return Response.json({ success: true } as ApiResponse);
  } catch (error) {
    logger.error('API:PUSH_TOKEN', error as Error);
    return Response.json(
      { success: false, error: 'Could not register for notifications' } as ApiResponse,
      { status: 500 }
    );
  }
}

/**
 * Stop sending to this device.
 *
 * Signing out should end delivery immediately rather than waiting for a sweep
 * — a phone that has been handed on must not keep receiving someone else's
 * recall notices. Scoped to the caller's own rows by the `user_id` filter as
 * well as by RLS, because the service-role client bypasses RLS entirely and a
 * missing filter here would delete another account's device.
 */
export async function DELETE(request: NextRequest): Promise<Response> {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const deviceId = request.nextUrl.searchParams.get('deviceId');
  if (!deviceId) {
    return Response.json({ success: false, error: 'Missing deviceId' } as ApiResponse, {
      status: 400,
    });
  }

  try {
    const client = getServiceRoleClient();

    const { error } = await client
      .from('device_push_tokens')
      .delete()
      .eq('user_id', caller.userId)
      .eq('device_id', deviceId);

    if (error) {
      logger.error('API:PUSH_TOKEN', new Error(error.message), { userId: caller.userId });
      return Response.json(
        { success: false, error: 'Could not stop notifications' } as ApiResponse,
        { status: 500 }
      );
    }

    return Response.json({ success: true } as ApiResponse);
  } catch (error) {
    logger.error('API:PUSH_TOKEN', error as Error);
    return Response.json(
      { success: false, error: 'Could not stop notifications' } as ApiResponse,
      { status: 500 }
    );
  }
}
