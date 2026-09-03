import { api, fail, ok, type ApiResult } from "./client";
import type {
  CreateSessionResponseT,
  DefineVersionResponseT,
  FileUploadResponseT,
  SessionSummaryT,
} from "./types";

/** GET /api/sessions — list all live upload sessions. */
export async function listSessions(): Promise<ApiResult<SessionSummaryT[]>> {
  const { data, error, response } = await api.GET("/api/sessions");
  return error || !data ? fail(error, response) : ok(data);
}

/**
 * POST /api/sessions — create a new session, optionally named. A blank/absent
 * name creates an unnamed session (no body sent). 400 = invalid name.
 */
export async function createSession(name?: string): Promise<ApiResult<CreateSessionResponseT>> {
  const trimmed = name?.trim();
  const { data, error, response } = await api.POST("/api/sessions", {
    body: trimmed ? { name: trimmed } : undefined,
  });
  return error || !data ? fail(error, response) : ok(data);
}

/**
 * PATCH /api/sessions/{id} — set or clear (blank) the session's display name.
 * Returns the updated session summary. 400 = invalid name, 404 = unknown session.
 */
export async function renameSession(
  sessionId: string,
  name: string,
): Promise<ApiResult<SessionSummaryT>> {
  const { data, error, response } = await api.PATCH("/api/sessions/{id}", {
    params: { path: { id: sessionId } },
    body: { name },
  });
  return error || !data ? fail(error, response) : ok(data);
}

/**
 * POST /api/sessions/{id}/files — stage one file into a session.
 *
 * The API reads the stored name from a `filename` `@RequestParam` (not the
 * multipart part's own filename). The bare name is sent once, as a query
 * parameter; the binary travels under a fixed `file` key. Sending the name a
 * second time (e.g. as a form field) makes Spring merge the two values into a
 * comma-joined string, so it must travel through a single channel. 409 =
 * duplicate name.
 */
export async function uploadFile(
  sessionId: string,
  filename: string,
  file: Blob,
): Promise<ApiResult<FileUploadResponseT>> {
  const form = new FormData();
  form.append("file", file, filename);
  const { data, error, response } = await api.POST("/api/sessions/{id}/files", {
    params: { path: { id: sessionId }, query: { filename } },
    body: form as unknown as { file: string },
    bodySerializer: (b) => b as unknown as FormData,
  });
  return error || !data ? fail(error, response) : ok(data);
}

/**
 * POST /api/sessions/{id}/files/from-url — stage a file by having the server
 * download an http/https URL. An optional bare `filename` overrides the name
 * derived from the URL path. 400 = bad URL/scheme, 409 = duplicate name,
 * 413 = the download exceeded the server's size cap.
 */
export async function uploadFileFromUrl(
  sessionId: string,
  url: string,
  filename?: string,
): Promise<ApiResult<FileUploadResponseT>> {
  const { data, error, response } = await api.POST("/api/sessions/{id}/files/from-url", {
    params: { path: { id: sessionId } },
    body: { url, filename },
  });
  return error || !data ? fail(error, response) : ok(data);
}

/** DELETE /api/sessions/{id} — delete a session (409 if it has in-flight runs). */
export async function deleteSession(sessionId: string): Promise<ApiResult<void>> {
  const { error, response } = await api.DELETE("/api/sessions/{id}", {
    params: { path: { id: sessionId } },
    parseAs: "stream",
  });
  return error ? fail(error, response) : ok(undefined);
}

/**
 * DELETE /api/sessions/{id}/files/{filename} — remove one staged file.
 * 404 = unknown session or file, 409 = the session has in-flight runs.
 */
export async function deleteSessionFile(
  sessionId: string,
  filename: string,
): Promise<ApiResult<void>> {
  const { error, response } = await api.DELETE("/api/sessions/{id}/files/{filename}", {
    params: { path: { id: sessionId, filename } },
    parseAs: "stream",
  });
  return error ? fail(error, response) : ok(undefined);
}

/**
 * DELETE /api/sessions/{id}/files — remove every staged file (the session itself
 * remains). 409 = the session has in-flight runs.
 */
export async function deleteAllSessionFiles(sessionId: string): Promise<ApiResult<void>> {
  const { error, response } = await api.DELETE("/api/sessions/{id}/files", {
    params: { path: { id: sessionId } },
    parseAs: "stream",
  });
  return error ? fail(error, response) : ok(undefined);
}

/**
 * GET /api/sessions/{id}/files/{filename}/define-version — detect the Define-XML
 * version of a staged file from its content. `version` ("1.0"/"2.0"/"2.1") and
 * `defineVersion` ("…/2.0.0/2.1.0") are both null when the file is not a
 * recognisable Define-XML document. 404 = unknown session or file.
 */
export async function getDefineVersion(
  sessionId: string,
  filename: string,
): Promise<ApiResult<DefineVersionResponseT>> {
  const { data, error, response } = await api.GET(
    "/api/sessions/{id}/files/{filename}/define-version",
    { params: { path: { id: sessionId, filename } } },
  );
  return error || !data ? fail(error, response) : ok(data);
}
