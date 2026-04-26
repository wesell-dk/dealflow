import { ApiError } from "@workspace/api-client-react";

/**
 * HTTP statuses that indicate a *transient* failure of the request-url
 * endpoint and are safe to retry without side effects (the endpoint only
 * reserves a row in `uploadedObjects`; the actual upload follows separately
 * with a fresh signed URL).
 *
 * 502/504 come from the Replit edge proxy when the API server is
 * momentarily unresponsive. 503 is what our own handler emits when the
 * object-storage sidecar is unavailable.
 */
const TRANSIENT_STATUSES = new Set([502, 503, 504]);

const RETRY_DELAYS_MS = [400, 1000];

function isTransientError(err: unknown): boolean {
  if (err instanceof ApiError) {
    return TRANSIENT_STATUSES.has(err.status);
  }
  if (err instanceof TypeError) {
    // Network-level error from fetch (DNS, connection reset, etc.).
    return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn` and retry up to two extra times on transient 502/503/504 or
 * network errors with a short backoff. Returns the successful value or
 * re-throws the last error after all retries are exhausted.
 *
 * Use this for `POST /api/v1/storage/uploads/request-url` (and the related
 * `external-contracts/upload-url`, `clause-imports/upload-url`) — these
 * calls are idempotent enough that a transparent retry hides the brief
 * unavailability that otherwise surfaces as a confusing 502 to the user.
 */
export async function withUploadUrlRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransientError(err) || attempt === RETRY_DELAYS_MS.length) {
        throw err;
      }
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  // Unreachable — the loop either returns or throws.
  throw lastError;
}

/**
 * Pull a structured German fachliche message out of common upload-failure
 * shapes. Falls back to the raw error message when nothing better is
 * available, but never leaks "HTTP 502 Bad Gateway" / "HTTP 503 Service
 * Unavailable" to the user.
 */
export function describeUploadError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 502 || err.status === 504) {
      return "Server temporarily unreachable. Please try again in a few seconds.";
    }
    if (err.status === 503) {
      return "File storage is currently unavailable. Please try again in a few seconds.";
    }
    if (err.status === 401) {
      return "Session expired — please sign in again.";
    }
    if (err.status === 403) {
      return "You do not have permission for this action.";
    }
    if (err.status === 413) {
      return "File is too large (max. 25 MB).";
    }
    const data = err.data as { message?: string; error?: string } | null;
    return data?.message ?? data?.error ?? err.message;
  }
  if (err instanceof TypeError) {
    return "Network unreachable. Please check your connection and try again.";
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Decide whether a raw `fetch` Response represents a transient failure of
 * the upload-url endpoint. Used by call-sites that bypass the generated
 * api-client (admin.tsx, brand-form-dialog.tsx) and call `fetch` directly.
 */
export function isTransientResponse(res: Response): boolean {
  return TRANSIENT_STATUSES.has(res.status);
}

/**
 * Same as `withUploadUrlRetry` but for raw `fetch`-based call sites.
 * Retries when the response is 502/503/504 or when fetch itself throws.
 */
export async function fetchUploadUrlWithRetry(
  url: string,
  init: RequestInit,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, init);
      if (!isTransientResponse(res) || attempt === RETRY_DELAYS_MS.length) {
        return res;
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
      if (!(err instanceof TypeError) || attempt === RETRY_DELAYS_MS.length) {
        throw err;
      }
    }
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
  throw lastError;
}
