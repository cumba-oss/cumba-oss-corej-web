import createClient, { type Client } from "openapi-fetch";
import type { paths } from "./schema";

/**
 * Same-origin base URL for every request. In dev the Vite server proxies
 * `/api` → the REST app; in prod the SPA is served from the REST jar's
 * `static/` on the same origin. We resolve to the absolute window origin
 * (rather than a bare "/") because openapi-fetch builds requests with the
 * WHATWG URL constructor, which rejects a relative base.
 */
function resolveBaseUrl(): string {
  return typeof window !== "undefined" && window.location?.origin
    ? window.location.origin
    : "http://localhost";
}

/**
 * Lazily-created type-safe API client. Construction is deferred to first use
 * so the base URL is read after the document/window is ready (e.g. once the
 * app has mounted, or once the test environment's window is initialised)
 * rather than at module-import time. A Proxy forwards each method access to
 * the real client while preserving openapi-fetch's exact generic types.
 */
let client: Client<paths> | undefined;

function getClient(): Client<paths> {
  client ??= createClient<paths>({ baseUrl: resolveBaseUrl() });
  return client;
}

/** The shared type-safe API client (lazy proxy over the real openapi-fetch client). */
export const api: Client<paths> = new Proxy({} as Client<paths>, {
  get(_target, prop: keyof Client<paths>) {
    return getClient()[prop];
  },
});

/**
 * A normalised API error. The REST app reports failures as RFC-7807
 * `ProblemDetail` JSON `{ status, detail, ... }`; this collapses that (and
 * any non-conforming error body) into a small, predictable shape the UI
 * can render in a toast.
 */
export interface ProblemError {
  /** HTTP status code of the failed response. */
  status: number;
  /** Human-readable detail, best-effort extracted from the body. */
  detail: string;
}

/** RFC-7807 problem-detail body (the fields the UI cares about). */
interface ProblemDetailBody {
  status?: number;
  detail?: string;
  title?: string;
  [key: string]: unknown;
}

/**
 * Map an openapi-fetch error payload + Response into a {@link ProblemError}.
 * Falls back to the response status and a sensible message when the body
 * is not a ProblemDetail (or is absent).
 */
export function toProblem(error: unknown, response: Response): ProblemError {
  const body = (error ?? undefined) as ProblemDetailBody | undefined;
  const status = typeof body?.status === "number" ? body.status : response.status;
  const detail = body?.detail || body?.title || response.statusText || `Request failed (${status})`;
  return { status, detail };
}

/**
 * A discriminated result: either the typed `data`, or a normalised
 * `problem`. Helpers return this so callers never have to touch the raw
 * Response or guess at the error shape.
 */
export type ApiResult<T> =
  | { data: T; problem?: undefined }
  | { data?: undefined; problem: ProblemError };

/** Build an ok result. */
export function ok<T>(data: T): ApiResult<T> {
  return { data };
}

/** Build an error result from an openapi-fetch error + Response. */
export function fail<T>(error: unknown, response: Response): ApiResult<T> {
  return { problem: toProblem(error, response) };
}
