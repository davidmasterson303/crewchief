import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { logger } from '@crewchief/core/logger';
import { readVisitorId } from '@/lib/funnel-visitor';
import { recordFunnelStepInBackground } from '@/lib/funnel';
import { claimScansForVisitor } from '@/lib/quote-check';

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const redirectTo = requestUrl.searchParams.get('redirect') || '/garage';

  if (code) {
    const response = NextResponse.redirect(new URL(redirectTo, requestUrl.origin));

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    /*
      Phase 2.97c. The email-verification path into an account, and the one the
      client-side claim cannot cover: the visitor may return here in a new tab,
      minutes or hours later, with the session established server-side and no
      signup component mounted to fire a request.

      Claimed here rather than redirected-then-claimed because the `cc_fv`
      cookie is httpOnly and this handler already holds it. Wrapped so a claim
      failure cannot break sign-in — arriving signed out because a scan could
      not be attached would be a far worse trade than an unclaimed scan.
    */
    if (data?.user && !error) {
      try {
        const visitorId = readVisitorId();
        if (visitorId) {
          const claimed = await claimScansForVisitor(visitorId, data.user.id);
          if (claimed > 0) {
            recordFunnelStepInBackground({ visitorId, step: 'saved' });
          }
        }
      } catch (err) {
        logger.warn('FRONT_DOOR:CLAIM_ON_CALLBACK_FAILED', 'Could not claim scans during verification', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return response;
  }

  return NextResponse.redirect(new URL('/login', requestUrl.origin));
}
