import { api, fail, ok, type ApiResult } from "./client";
import type { CheckRunRequestT, CheckStatusT, StartCheckResponseT } from "./types";

/** POST /api/sessions/{id}/checks — queue a check run over a session's files. */
export async function startCheck(
  sessionId: string,
  request: CheckRunRequestT,
): Promise<ApiResult<StartCheckResponseT>> {
  const { data, error, response } = await api.POST("/api/sessions/{id}/checks", {
    params: { path: { id: sessionId } },
    body: request,
  });
  return error || !data ? fail(error, response) : ok(data);
}

/**
 * GET /api/checks[?sessionId=] — list run status snapshots, optionally
 * scoped to a single session.
 */
export async function listChecks(sessionId?: string): Promise<ApiResult<CheckStatusT[]>> {
  const { data, error, response } = await api.GET("/api/checks", {
    params: { query: sessionId ? { sessionId } : {} },
  });
  return error || !data ? fail(error, response) : ok(data);
}

/**
 * GET /api/checks/{id}/status?waitSeconds=N — current status snapshot.
 * With `waitSeconds > 0` the server long-polls (capped at 60s) for a
 * terminal state before returning.
 */
export async function awaitStatus(
  checkRunId: string,
  waitSeconds?: number,
): Promise<ApiResult<CheckStatusT>> {
  const { data, error, response } = await api.GET("/api/checks/{id}/status", {
    params: {
      path: { id: checkRunId },
      query: waitSeconds === undefined ? {} : { waitSeconds },
    },
  });
  return error || !data ? fail(error, response) : ok(data);
}

/** POST /api/checks/{id}/cancel — request cancellation of a run (202). */
export async function cancelCheck(checkRunId: string): Promise<ApiResult<void>> {
  // parseAs:"stream" avoids JSON-parsing the empty 202 body.
  const { error, response } = await api.POST("/api/checks/{id}/cancel", {
    params: { path: { id: checkRunId } },
    parseAs: "stream",
  });
  return error ? fail(error, response) : ok(undefined);
}

/** DELETE /api/checks/{id} — delete a run and its report (409 if in flight). */
export async function deleteCheck(checkRunId: string): Promise<ApiResult<void>> {
  const { error, response } = await api.DELETE("/api/checks/{id}", {
    params: { path: { id: checkRunId } },
    parseAs: "stream",
  });
  return error ? fail(error, response) : ok(undefined);
}
