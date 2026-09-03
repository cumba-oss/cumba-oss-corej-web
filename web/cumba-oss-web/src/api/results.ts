import { api, fail, ok, type ApiResult } from "./client";
import type {
  ConformanceResponseT,
  FileGroupT,
  FindingsPageT,
  LiveLogResponseT,
  RuleDefinitionT,
  RuleReportRowT,
  RunArtifactsT,
  RunLogT,
} from "./types";

/** GET /api/checks/{id}/artifacts — sizes + generation time of the run's downloadable artifacts. */
export async function artifacts(checkRunId: string): Promise<ApiResult<RunArtifactsT>> {
  const { data, error, response } = await api.GET("/api/checks/{id}/artifacts", {
    params: { path: { id: checkRunId } },
  });
  return error || !data ? fail(error, response) : ok(data);
}

/**
 * GET /api/checks/{id}/dataset-groups — the run's results grouped by file then
 * domain (each file's metadata + its domains' metadata and rule outcomes,
 * including the per-rule violation count). Findings are NOT embedded — they are
 * fetched on demand, scoped and paged, via {@link findings}.
 */
export async function datasetGroups(checkRunId: string): Promise<ApiResult<FileGroupT[]>> {
  const { data, error, response } = await api.GET("/api/checks/{id}/dataset-groups", {
    params: { path: { id: checkRunId } },
  });
  return error || !data ? fail(error, response) : ok(data);
}

/** Filters + paging for {@link findings}. */
export interface FindingsQuery {
  /** Restrict to one file (the dataset's source file name). */
  file?: string;
  /** Restrict to one domain. */
  domain?: string;
  /** Restrict to one rule (CORE id). */
  coreId?: string;
  /** First row index (0-based). */
  firstIndex?: number;
  /** Page size. */
  count?: number;
}

/**
 * GET /api/checks/{id}/findings — a page of findings, optionally scoped to a
 * file / domain / rule. Drives the results drill-down: load only the findings of
 * the rule the user expanded. Always reports the full matching `total`.
 *
 * Each row also carries the EC-40 record key (`keyVariables` / `keys` /
 * `keySource`) when the run resolved one; the fields are absent under the
 * default `corej.findingKeys=off`.
 */
export async function findings(
  checkRunId: string,
  query: FindingsQuery = {},
): Promise<ApiResult<FindingsPageT>> {
  const { data, error, response } = await api.GET("/api/checks/{id}/findings", {
    params: { path: { id: checkRunId }, query },
  });
  return error || !data ? fail(error, response) : ok(data);
}

/** GET /api/checks/{id}/conformance — run conformance metadata. */
export async function conformance(checkRunId: string): Promise<ApiResult<ConformanceResponseT>> {
  const { data, error, response } = await api.GET("/api/checks/{id}/conformance", {
    params: { path: { id: checkRunId } },
  });
  return error || !data ? fail(error, response) : ok(data);
}

/** GET /api/checks/{id}/rules — per-rule outcomes (flat rules report). */
export async function rules(checkRunId: string): Promise<ApiResult<RuleReportRowT[]>> {
  const { data, error, response } = await api.GET("/api/checks/{id}/rules", {
    params: { path: { id: checkRunId } },
  });
  return error || !data ? fail(error, response) : ok(data);
}

/**
 * GET /api/checks/{id}/report — the full JSON report document, fetched as a
 * Blob so the caller can trigger a file download without rendering it inline.
 */
export async function downloadReport(checkRunId: string): Promise<ApiResult<Blob>> {
  const { data, error, response } = await api.GET("/api/checks/{id}/report", {
    params: { path: { id: checkRunId } },
    parseAs: "blob",
  });
  return error || !data ? fail(error, response) : ok(data as Blob);
}

/**
 * GET /api/checks/{id}/report-v2 — the v2 combined-finding report document
 * (one object per finding, carrying its location plus its rows), fetched as a
 * Blob so the caller can trigger a file download without rendering it inline.
 */
export async function downloadReportV2(checkRunId: string): Promise<ApiResult<Blob>> {
  const { data, error, response } = await api.GET("/api/checks/{id}/report-v2", {
    params: { path: { id: checkRunId } },
    parseAs: "blob",
  });
  return error || !data ? fail(error, response) : ok(data as Blob);
}

/** GET /api/checks/{id}/report (Accept: xlsx) — the report rendered as an Excel workbook. */
export async function downloadReportXlsx(checkRunId: string): Promise<ApiResult<Blob>> {
  const { data, error, response } = await api.GET("/api/checks/{id}/report", {
    params: { path: { id: checkRunId } },
    headers: { Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    parseAs: "blob",
  });
  return error || !data ? fail(error, response) : ok(data as Blob);
}

/**
 * GET /api/checks/{id}/log — the structured execution log (files + hashes,
 * configuration, per-domain rules executed/total + findings, and errors).
 * Available for terminal runs that started (SUCCEEDED / FAILED / CANCELLED);
 * a run with no log answers 409.
 */
export async function getLog(checkRunId: string): Promise<ApiResult<RunLogT>> {
  const { data, error, response } = await api.GET("/api/checks/{id}/log", {
    params: { path: { id: checkRunId } },
  });
  return error || !data ? fail(error, response) : ok(data);
}

/**
 * GET /api/checks/{id}/log/lines?from=N — incremental live log lines, available
 * while the run is RUNNING (and on PENDING/terminal runs too). Lines are
 * append-only and 0-indexed; pass the returned `nextFrom` back as the next
 * `from` to stream only newly-appended lines. The `terminal` flag is an early
 * signal (it flips before the structured log is persisted) — use it only to
 * STOP polling, never to trigger the full {@link getLog} fetch.
 */
export async function logLines(checkRunId: string, from = 0): Promise<ApiResult<LiveLogResponseT>> {
  const { data, error, response } = await api.GET("/api/checks/{id}/log/lines", {
    params: { path: { id: checkRunId }, query: { from } },
  });
  return error || !data ? fail(error, response) : ok(data);
}

/**
 * GET /api/checks/{id}/log/file — the raw, pretty-printed execution-log file,
 * fetched as a Blob so the caller can trigger a download whose bytes match the
 * server-reported `logBytes` size (unlike re-serialising the parsed RunLog).
 */
export async function downloadLog(checkRunId: string): Promise<ApiResult<Blob>> {
  const { data, error, response } = await api.GET("/api/checks/{id}/log/file", {
    params: { path: { id: checkRunId } },
    parseAs: "blob",
  });
  return error || !data ? fail(error, response) : ok(data as Blob);
}

/**
 * GET /api/checks/{id}/rules/{coreId}/definition — the run-scoped rule
 * definition `{ source, expanded }` for one rule (by the row's CORE id). Used
 * by the rule-definition overlay; `source` is the raw pack rule object and
 * `expanded` the synthetic generated rule that ran (null for plain rules).
 */
export async function ruleDefinition(
  checkRunId: string,
  coreId: string,
): Promise<ApiResult<RuleDefinitionT>> {
  const { data, error, response } = await api.GET("/api/checks/{id}/rules/{coreId}/definition", {
    params: { path: { id: checkRunId, coreId } },
  });
  return error || !data ? fail(error, response) : ok(data as RuleDefinitionT);
}
