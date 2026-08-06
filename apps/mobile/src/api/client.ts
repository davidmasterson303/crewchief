import { API_BASE_URL, API_PREFIX } from '../config';
import { getAccessToken } from '../auth/session';

/**
 * The only way this app talks to CrewChief.
 *
 * Everything goes through `/api/v1` with a bearer token, because that is the
 * path `lib/api-auth.ts` authorizes — one implementation of who may see what,
 * already tested, shared with the web app. The alternative is querying Supabase
 * from the device, which is a second answer to the same question and is how
 * `VehicleCard` shipped an unauthorized delete.
 *
 * The token is fetched per request rather than held: `getAccessToken` returns
 * the live session and refreshes an expired one, so a long-lived screen cannot
 * send a token that was valid when it mounted.
 */

/**
 * Where a failure was decided.
 *
 * **A 401 means two completely different things and they were indistinguishable
 * until 5 Aug.** `device` is this client refusing to send at all because it
 * holds no session; `server` is CrewChief rejecting a token that *was* sent.
 * Both produced "Your session ended", so a real upload failure could not be
 * told from a request that never left the phone — which is exactly the
 * question that mattered when the invoice upload started 401ing while every
 * read on the same session kept working.
 */
export type FailureOrigin = 'device' | 'server';

export interface ApiError {
  status: number;
  message: string;
  origin?: FailureOrigin;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly origin: FailureOrigin;

  constructor({ status, message, origin = 'server' }: ApiError) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.origin = origin;
  }

  /** The session is gone or was rejected. Callers send the user to sign in. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /**
   * True only when **this device** decided it has no session.
   *
   * The distinction is worth acting on, not just logging: a `device` 401 is
   * genuinely signed out and clearing the session is correct. A `server` 401
   * may be a token the server would accept a second later, and destroying a
   * working session over one response is how a spurious failure becomes a
   * forced re-login.
   */
  get isLocallySignedOut(): boolean {
    return this.status === 401 && this.origin === 'device';
  }
}

interface RequestOptions {
  /*
    DELETE is here for `/api/v1/account` — App Store 5.1.1(v). The route is
    DELETE rather than POST deliberately (see its docblock), and adding the
    verb here rather than working around it with a POST alias keeps the mobile
    client speaking the same contract the web app and the tests do.
  */
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  /** Endpoints that serve demo data work without a session. */
  allowAnonymous?: boolean;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, allowAnonymous = false } = options;

  const token = await getAccessToken();

  if (!token && !allowAnonymous) {
    /*
      Fail here rather than sending an unauthenticated request and reading the
      401 back. The round trip tells us nothing we do not already know, and on
      a slow connection it turns an instant "you are signed out" into several
      seconds of spinner.
    */
    throw new ApiRequestError({
      status: 401,
      message: 'Not signed in',
      // Decided here. Nothing was sent, so this is never the server's verdict.
      origin: 'device',
    });
  }

  /*
    `FormData` is the invoice upload (Phase 3.3) and is deliberately not
    serialised. Two things must not happen to it:

      - `JSON.stringify(formData)` returns `"{}"`, silently uploading nothing.
      - Setting `Content-Type: multipart/form-data` by hand omits the boundary
        parameter that the runtime generates, and the server cannot parse the
        body without it.

    So a FormData body is passed through untouched and its header is left for
    the platform to set. Everything else keeps the JSON path exactly as it was.
  */
  const isMultipart = typeof FormData !== 'undefined' && body instanceof FormData;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !isMultipart) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${API_PREFIX}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isMultipart ? (body as FormData) : JSON.stringify(body),
    });
  } catch (error) {
    // Distinguished from an HTTP error on purpose: a phone loses connectivity
    // constantly, and "check your connection" is actionable where "something
    // went wrong" is not.
    throw new ApiRequestError({
      status: 0,
      message: 'Could not reach CrewChief. Check your connection.',
      origin: 'device',
    });
  }

  const payload = await readJson(response);

  if (!response.ok) {
    throw new ApiRequestError({
      status: response.status,
      // The server's own message when it sent one — those are written to be
      // shown and are careful not to leak whether a resource exists.
      message: typeof payload?.error === 'string' ? payload.error : `Request failed (${response.status})`,
    });
  }

  return payload as T;
}

/**
 * Parse a response body without throwing on an empty or non-JSON one.
 *
 * A 502 from an edge proxy arrives as HTML, and `response.json()` throwing on
 * it would surface a JSON parse error instead of the status that actually
 * matters. This is the cold-start symptom `STATUS` records against
 * `/api/version` — HTML where JSON was expected, moments after a deploy.
 */
async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}
