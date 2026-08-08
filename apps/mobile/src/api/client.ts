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

/**
 * What actually went wrong, when `status` cannot say.
 *
 * **"Could not reach CrewChief" covered three different fixes**: genuinely
 * offline, a request that ran out of patience, and a server that accepted the
 * request and never answered. On 5 Aug that ambiguity sent a tester to check
 * their Wi-Fi while the real cause was a cold serverless function — and then
 * hid an upload failure behind the same sentence twice more.
 *
 * `request` was added on David's observation after the FormData defect: a throw
 * at 4ms, before any socket opens, is **not** "offline" — the request could not
 * be built, which is a bug in this app rather than a condition of the network.
 * Reporting it as connectivity is what hid that defect through three rounds of
 * testing.
 *
 * `http` is the ordinary case where the status code is the whole story.
 */
export type FailureKind = 'http' | 'offline' | 'timeout' | 'request';

export interface ApiError {
  status: number;
  message: string;
  origin?: FailureOrigin;
  kind?: FailureKind;
  /** Wall-clock time until the failure. The single most diagnostic number. */
  elapsedMs?: number;
  /** The runtime's own words, for a dev build to show. Never shown in release. */
  cause?: string;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly origin: FailureOrigin;
  readonly kind: FailureKind;
  readonly elapsedMs: number | null;
  readonly cause: string | null;

  constructor({ status, message, origin = 'server', kind = 'http', elapsedMs, cause }: ApiError) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.origin = origin;
    this.kind = kind;
    this.elapsedMs = elapsedMs ?? null;
    this.cause = cause ?? null;
  }

  /**
   * A one-line technical summary for a development build.
   *
   * Exists because three separate rounds of testing could not answer "did the
   * request reach the server, and how long did it take" from the screen. The
   * elapsed time is what distinguishes an instant refusal from a platform
   * ceiling, and it was the number missing every time.
   */
  get diagnostic(): string {
    const parts = [`${this.kind}`, `origin=${this.origin}`, `status=${this.status}`];
    if (this.elapsedMs !== null) parts.push(`${this.elapsedMs}ms`);
    if (this.cause) parts.push(this.cause);
    return parts.join(' · ');
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
  /*
    PATCH is here for `PATCH /api/v1/vehicles` — the odometer confirmation the
    service milestone screen opens on. Added the same way DELETE was and for
    the same reason: the route is PATCH because it updates one field of an
    existing row, and aliasing it to POST to avoid touching this union would
    give the mobile client a private contract that the web app and the tests do
    not share.

    Nothing below branches on the verb — `method` is passed straight to `fetch`
    and to `request.open` — so widening this is genuinely the whole change.
  */
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Endpoints that serve demo data work without a session. */
  allowAnonymous?: boolean;
  /**
   * How long to wait before giving up, in ms.
   *
   * Explicit because the platform default is 60s, which is far longer than
   * anyone will sit looking at a spinner, and because a request that is
   * abandoned *by us* must be reported differently from one that could not be
   * sent at all. An invoice upload legitimately takes longer than a read —
   * measured: a comparable multipart-plus-vision call answers in ~7.7s warm.
   */
  timeoutMs?: number;
}

/** Reads are quick or something is wrong. */
const DEFAULT_TIMEOUT_MS = 20_000;

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, allowAnonymous = false, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

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

  /*
    ── Multipart goes over XMLHttpRequest, not fetch ─────────────────────────

    The global `fetch` here is Expo's, and its multipart encoder needs a real
    `Blob` — it calls `blobToArrayBufferAsync`, which falls back to
    `FileReader.readAsArrayBuffer` for anything lacking `arrayBuffer()`.
    **Neither half of that works on this binary**: React Native's `Blob`
    implements only `slice`/`size`/`type`, and `FileReaderModule` is not
    compiled into the installed app — verified by reading the dylib, where
    `BlobModule` appears 8 times and `FileReaderModule` zero.

    So the Blob route is closed without a new cloud build, and appending
    React Native's `{ uri, name, type }` part to Expo's fetch is what produced
    `Unsupported FormDataPart implementation` at 4ms.

    XHR is React Native's own networking. It understands that part shape
    natively, **streams the file from disk** rather than materialising it in
    memory, and sets the multipart boundary itself. Expo only *patches* RN's
    FormData rather than replacing it, so `new FormData()` still carries the
    `getParts()` that XHR reads.

    Everything else keeps the fetch path exactly as it was.
  */
  if (isMultipart) {
    return sendMultipart<T>({
      url: `${API_BASE_URL}${API_PREFIX}${path}`,
      method,
      headers,
      form: body as FormData,
      timeoutMs,
    });
  }

  /*
    Timed, and abandoned deliberately rather than left to the platform's 60s.
    The elapsed number is the point: an instant failure is a phone with no
    route to the host, and a failure at a suspiciously round number of seconds
    is a ceiling somewhere in the middle. Three rounds of testing could not
    tell those apart because neither the duration nor the cause was recorded.
  */
  const startedAt = Date.now();
  const controller = new AbortController();
  const abandon = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${API_PREFIX}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isMultipart ? (body as FormData) : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const timedOut = controller.signal.aborted;

    /*
      A network failure says so. React Native and Expo both surface transport
      problems as "Network request failed" or an abort; anything else reaching
      here — an unencodable body, a malformed URL — never touched the network
      and must not claim the network is at fault.

      Matched on the message because that is the only signal the runtime gives,
      and erring toward `request` is the safe direction: mislabelling a genuine
      outage as a client bug sends someone to read a log, while the reverse
      sends them to restart their router.
    */
    const cause = (error as Error)?.message ?? '';
    const looksLikeTransport = /network request failed|timed out|connection|abort/i.test(cause);
    const kind: FailureKind = timedOut ? 'timeout' : looksLikeTransport ? 'offline' : 'request';

    /*
      Three outcomes wore one sentence until now. "Check your connection" is
      actionable when it is true and actively misleading when it is not — it
      sent someone to look at their Wi-Fi while a serverless function was
      merely cold.
    */
    throw new ApiRequestError({
      status: 0,
      origin: 'device',
      kind,
      elapsedMs,
      cause,
      message:
        kind === 'timeout'
          ? `CrewChief did not answer within ${Math.round(timeoutMs / 1000)} seconds.`
          : kind === 'offline'
            ? 'Could not reach CrewChief. Check your connection.'
            : // Deliberately does not mention the connection. This is our bug,
              // and telling someone to check their Wi-Fi wastes their time.
              'CrewChief could not send that request.',
    });
  } finally {
    clearTimeout(abandon);
  }

  const { parsed: payload, raw } = await readBody(response);

  if (!response.ok) {
    throw new ApiRequestError({
      status: response.status,
      kind: 'http',
      // Recorded on the success-shaped path too: a 502 at ten seconds is a
      // platform ceiling and a 502 at fifty milliseconds is a bad deploy, and
      // the status alone does not distinguish them.
      elapsedMs: Date.now() - startedAt,
      /*
        The body, trimmed. A 400 from validation and a 500 from storage are the
        same sentence on screen without it, and an HTML error page — which is
        what an edge proxy returns — carries no `error` field at all, so the
        parsed payload would be empty exactly when the raw text matters most.
      */
      cause: raw ? raw.slice(0, 300) : undefined,
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
/**
 * POST a multipart form through React Native's networking.
 *
 * Mirrors the fetch path's error contract exactly — same `kind`, same
 * `elapsedMs`, same `cause`, same body capture — because a failure here must
 * be as legible as one there. The whole reason this branch exists is that a
 * failure on it was, for three rounds, indistinguishable from a network
 * outage.
 */
function sendMultipart<T>({
  url,
  method,
  headers,
  form,
  timeoutMs,
}: {
  url: string;
  method: string;
  headers: Record<string, string>;
  form: FormData;
  timeoutMs: number;
}): Promise<T> {
  const startedAt = Date.now();

  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, url);

    /*
      Content-Type is deliberately not set. React Native generates the
      multipart boundary when it serialises the form, and a hand-written
      header omits it — leaving a body the server cannot parse.
    */
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === 'content-type') continue;
      request.setRequestHeader(key, value);
    }

    request.timeout = timeoutMs;

    request.onload = () => {
      const elapsedMs = Date.now() - startedAt;
      const raw = request.responseText ?? '';

      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // An edge proxy answers with HTML. The raw text is then the only clue,
        // and it is exactly the case where the parsed body would be empty.
      }

      if (request.status < 200 || request.status >= 300) {
        reject(
          new ApiRequestError({
            status: request.status,
            kind: 'http',
            elapsedMs,
            cause: raw ? raw.slice(0, 300) : undefined,
            message:
              typeof parsed?.error === 'string'
                ? parsed.error
                : `Request failed (${request.status})`,
          })
        );
        return;
      }

      resolve(parsed as T);
    };

    request.ontimeout = () =>
      reject(
        new ApiRequestError({
          status: 0,
          origin: 'device',
          kind: 'timeout',
          elapsedMs: Date.now() - startedAt,
          cause: 'XMLHttpRequest timeout',
          message: `CrewChief did not answer within ${Math.round(timeoutMs / 1000)} seconds.`,
        })
      );

    request.onerror = () =>
      reject(
        new ApiRequestError({
          status: 0,
          origin: 'device',
          kind: 'offline',
          elapsedMs: Date.now() - startedAt,
          cause: 'XMLHttpRequest error',
          message: 'Could not reach CrewChief. Check your connection.',
        })
      );

    try {
      request.send(form);
    } catch (error) {
      // Building the request failed — our bug, not the network's.
      reject(
        new ApiRequestError({
          status: 0,
          origin: 'device',
          kind: 'request',
          elapsedMs: Date.now() - startedAt,
          cause: (error as Error)?.message,
          message: 'CrewChief could not send that request.',
        })
      );
    }
  });
}

async function readBody(
  response: Response
): Promise<{ parsed: Record<string, unknown> | null; raw: string | null }> {
  /*
    Text first, then parse. `response.json()` consumes the stream, so a failed
    parse would leave nothing to look at — and a body that will not parse is
    exactly the case where reading it matters, since an edge proxy answers with
    HTML rather than JSON.
  */
  if (typeof response.text === 'function') {
    let raw: string | null = null;
    try {
      raw = await response.text();
    } catch {
      return { parsed: null, raw: null };
    }

    try {
      return { parsed: JSON.parse(raw) as Record<string, unknown>, raw };
    } catch {
      return { parsed: null, raw };
    }
  }

  /*
    Falls back to `json()` where `text()` is absent. Not defensive clutter: a
    test double caught this, and the failure mode is the quiet one — the
    server's own error message silently replaced by "Request failed (404)",
    which is precisely the class of message-flattening this whole round has
    been about.
  */
  try {
    return { parsed: (await response.json()) as Record<string, unknown>, raw: null };
  } catch {
    return { parsed: null, raw: null };
  }
}
