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

export interface ApiError {
  status: number;
  message: string;
}

export class ApiRequestError extends Error {
  readonly status: number;

  constructor({ status, message }: ApiError) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }

  /** The session is gone or was rejected. Callers send the user to sign in. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST';
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
    throw new ApiRequestError({ status: 401, message: 'Not signed in' });
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${API_PREFIX}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    // Distinguished from an HTTP error on purpose: a phone loses connectivity
    // constantly, and "check your connection" is actionable where "something
    // went wrong" is not.
    throw new ApiRequestError({
      status: 0,
      message: 'Could not reach CrewChief. Check your connection.',
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
