import type { components } from "./schema";

/**
 * Friendly aliases over the generated OpenAPI component schemas. The `T`
 * suffix avoids clashing with value identifiers and signals "type". These
 * are the only API DTO names the rest of the app should reference — the
 * raw `components["schemas"][...]` indirection stays in this file.
 */
type Schemas = components["schemas"];

export type SessionSummaryT = Schemas["SessionSummary"];
export type SessionFileT = Schemas["SessionFile"];
export type CreateSessionResponseT = Schemas["CreateSessionResponse"];
export type FileUploadResponseT = Schemas["FileUploadResponse"];
export type DefineVersionResponseT = Schemas["DefineVersionResponse"];
export type CheckRunRequestT = Schemas["CheckRunRequest"];
export type StartCheckResponseT = Schemas["StartCheckResponse"];
export type CheckStatusT = Schemas["CheckStatusResponse"];
export type FindingRowT = Schemas["FindingRow"];
export type FindingsPageT = Schemas["FindingsPage"];
export type RuleReportRowT = Schemas["RuleReportRow"];
export type ConformanceResponseT = Schemas["ConformanceResponse"];
export type InfoT = Schemas["Info"];
export type RunOptionsT = Schemas["RunOptions"];
export type PackageOptionT = Schemas["PackageOption"];
export type RuleOptionsT = Schemas["RuleOptions"];
export type RuleOptionT = Schemas["RuleOption"];
export type RunLogT = Schemas["RunLog"];
export type RuleExecutionEntryT = Schemas["RuleExecutionEntry"];
export type FileGroupT = Schemas["FileGroup"];
export type DomainGroupT = Schemas["DomainGroup"];
export type RunArtifactsT = Schemas["RunArtifacts"];
export type LiveLogResponseT = Schemas["LiveLogResponse"];

/**
 * Run-scoped rule definition returned by
 * `GET /api/checks/{id}/rules/{coreId}/definition`: the raw source rule object
 * and, for generated/expanded rules, the synthetic concrete rule that ran.
 * Both are arbitrary JSON (`source` / `expanded`), either may be null.
 */
export interface RuleDefinitionT {
  /** The run's raw source rule object (null when not found). */
  source?: unknown;
  /** The synthetic generated rule that ran (null for non-generated rules). */
  expanded?: unknown;
  [key: string]: unknown;
}

/** Run lifecycle status values. */
export type CheckRunStatusT = NonNullable<CheckStatusT["status"]>;
