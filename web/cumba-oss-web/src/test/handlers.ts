import { http, HttpResponse } from "msw";
import type {
  CheckRunRequestT,
  CheckStatusT,
  ConformanceResponseT,
  CreateSessionResponseT,
  FileGroupT,
  FindingsPageT,
  FileUploadResponseT,
  InfoT,
  RuleOptionsT,
  RuleReportRowT,
  RunLogT,
  RunOptionsT,
  SessionSummaryT,
  StartCheckResponseT,
} from "../api/types";

/**
 * Default MSW handlers — one per REST endpoint, returning representative
 * happy-path payloads shaped to the generated schema. Individual tests
 * override these with `server.use(...)` to exercise error mappings.
 */

const sessionSummary: SessionSummaryT = {
  sessionId: "s-1",
  name: "Demo study",
  createdAt: "2026-05-28T10:00:00Z",
  fileCount: 2,
  files: [
    { filename: "ae.xpt", sizeBytes: 2048, uploadedAt: "2026-05-28T10:01:00Z" },
    { filename: "dm.xpt", sizeBytes: 1024, uploadedAt: "2026-05-28T10:00:30Z" },
  ],
};

const createSessionResponse: CreateSessionResponseT = { sessionId: "s-1", name: "Demo study" };

const fileUploadResponse: FileUploadResponseT = {
  sessionId: "s-1",
  filename: "dm.xpt",
  size: 1024,
};

const startCheckResponse: StartCheckResponseT = { checkRunId: "c-1" };

const checkStatus: CheckStatusT = {
  checkRunId: "c-1",
  sessionId: "s-1",
  sessionName: "Demo study",
  status: "SUCCEEDED",
  totalDatasets: 3,
  processedDatasets: 3,
  rulesExecuted: 120,
  findingCount: 7,
  message: undefined,
  createdAt: "2026-05-28T10:00:00Z",
  startedAt: "2026-05-28T10:00:01Z",
  finishedAt: "2026-05-28T10:00:09Z",
};

const conformance: ConformanceResponseT = {
  standard: "SDTMIG",
  version: "V3.4",
  tigUseCase: undefined,
  ctVersion: "2023-12-15",
  defineXmlVersion: "2.1",
  coreEngineVersion: "1.0",
  totalRuntime: "12.34 seconds",
  issueLimitPerRule: "None",
  issueLimitPerDataset: "false",
  reportGeneration: "2026-05-28T10:00:09Z",
};

const rules: RuleReportRowT[] = [
  {
    coreId: "CORE-000001",
    version: "1",
    cdiscRuleId: "CG0001",
    fdaRuleId: "FDA0001",
    message: "USUBJID is required",
    status: "SOME_ISSUES",
  },
];

// Deliberately fake version so the mock can never be mistaken for, or re-pin,
// the real build version (which the backend now derives from version.properties).
const info: InfoT = { service: "corej-cdisc-rest", version: "1.2.3-TEST" };

const report = { conformance, rules };

// Empty by default so the run form falls back to free-text inputs; tests that
// exercise the dropdowns override these with populated payloads.
const runOptions: RunOptionsT = { packages: [], defineVersions: [] };

const ruleOptions: RuleOptionsT = { rules: [], useCases: [] };

const ruleExecutions = [
  {
    coreId: "CORE-000001",
    generatedId: "uuid-1",
    status: "EXECUTED",
    violations: 2,
    runtimeMillis: 250,
    expandedFor: undefined,
    notExecutedReason: undefined,
    description: "USUBJID must be present",
    executability: "Fully Executable",
  },
  {
    coreId: "CG0001-AGE",
    generatedId: "uuid-2",
    status: "SKIPPED",
    violations: 0,
    runtimeMillis: -1,
    expandedFor: "AGE",
    notExecutedReason: "no Library access",
    description: "AGE range check",
  },
];

const runArtifacts = {
  reportBytes: 4096,
  reportV2Bytes: 2048,
  reportXlsxBytes: 8192,
  logBytes: 512,
  // Fractional seconds so the timestamp formatting is exercised.
  generatedAt: "2026-05-29T10:06:00.123Z",
};

/** A run-scoped rule definition (source only — non-generated rule). */
const sampleRuleDefinition = {
  source: {
    Core: { Id: "CORE-000001" },
    Description: "DM rule",
  },
  expanded: null,
};

const datasetGroups: FileGroupT[] = [
  {
    fileName: "dm.xpt",
    sizeBytes: 1024,
    sha256: "abc123",
    modificationDate: "2026-05-28T09:00:00Z",
    domains: [
      {
        domain: "DM",
        label: "Demographics",
        rows: 100,
        columns: 25,
        runtimeMillis: 1500,
        rules: ruleExecutions,
      },
    ],
  },
];

const findingsPage: FindingsPageT = {
  total: 2,
  firstIndex: 0,
  count: 2,
  items: [
    {
      coreId: "CORE-000001",
      dataset: "dm.xpt",
      domain: "DM",
      usubjid: "STUDY-001",
      row: 1,
      seq: "1",
      executability: "FULLY_EXECUTABLE",
      message: "USUBJID is required",
      variables: ["USUBJID"],
      values: [""],
    },
    {
      coreId: "CORE-000001",
      dataset: "dm.xpt",
      domain: "DM",
      usubjid: "STUDY-002",
      row: 2,
      seq: "2",
      executability: "FULLY_EXECUTABLE",
      message: "USUBJID is required",
      variables: ["USUBJID"],
      values: [""],
    },
  ],
};

const runLog: RunLogT = {
  runId: "c-1",
  sessionId: "s-1",
  status: "SUCCEEDED",
  createdAt: "2026-05-28T10:00:00Z",
  startedAt: "2026-05-28T10:00:01Z",
  finishedAt: "2026-05-28T10:00:09Z",
  totalRuntimeSeconds: 12.34,
  configuration: { rulesPackages: ["cdisc-sdtmig-3-4"] },
  files: [{ filename: "dm.xpt", sizeBytes: 1024, sha256: "abc123" }],
  domains: [
    {
      domain: "DM",
      fileName: "dm.xpt",
      rulesExecuted: 3,
      rulesTotal: 10,
      findings: 2,
      runtimeMillis: 1500,
      errors: [],
      ruleExecutions,
    },
  ],
  totalFindings: 7,
  failureMessage: undefined,
  logLines: ["INFO Selected 10 rule(s) for validation"],
};

export const handlers = [
  // Sessions
  http.get("/api/sessions", () => HttpResponse.json([sessionSummary])),
  http.post("/api/sessions", () => HttpResponse.json(createSessionResponse)),
  http.patch("/api/sessions/:id", () =>
    HttpResponse.json({ ...sessionSummary, name: "Renamed study" }),
  ),
  http.post("/api/sessions/:id/files", () =>
    HttpResponse.json(fileUploadResponse, { status: 201 }),
  ),
  http.delete("/api/sessions/:id", () => new HttpResponse(null, { status: 204 })),
  http.delete("/api/sessions/:id/files", () => new HttpResponse(null, { status: 204 })),
  http.delete("/api/sessions/:id/files/:filename", () => new HttpResponse(null, { status: 204 })),
  http.get("/api/sessions/:id/files/:filename/define-version", () =>
    HttpResponse.json({ version: "2.1", defineVersion: "2.1.0" }),
  ),

  // Checks
  http.post("/api/sessions/:id/checks", () =>
    HttpResponse.json(startCheckResponse, { status: 201 }),
  ),
  http.get("/api/checks", () => HttpResponse.json([checkStatus])),
  http.get("/api/checks/:id/status", () => HttpResponse.json(checkStatus)),
  http.post("/api/checks/:id/cancel", () => new HttpResponse(null, { status: 202 })),
  http.delete("/api/checks/:id", () => new HttpResponse(null, { status: 204 })),

  // Results
  http.get("/api/checks/:id/dataset-groups", () => HttpResponse.json(datasetGroups)),
  http.get("/api/checks/:id/findings", () => HttpResponse.json(findingsPage)),
  http.get("/api/checks/:id/artifacts", () => HttpResponse.json(runArtifacts)),
  http.get("/api/checks/:id/conformance", () => HttpResponse.json(conformance)),
  http.get("/api/checks/:id/rules", () => HttpResponse.json(rules)),
  http.get("/api/checks/:id/report", () => HttpResponse.json(report)),
  http.get("/api/checks/:id/report-v2", () =>
    HttpResponse.json({ Report_Version: "2.0", Findings: [] }),
  ),
  http.get("/api/checks/:id/log/lines", () =>
    HttpResponse.json({ lines: [], nextFrom: 0, terminal: true }),
  ),
  http.get("/api/checks/:id/log", () => HttpResponse.json(runLog)),
  http.get("/api/checks/:id/log/file", () =>
    HttpResponse.json(runLog, {
      headers: {
        "content-type": "application/json",
        "content-disposition": 'attachment; filename="log-c-1.json"',
      },
    }),
  ),
  http.get("/api/checks/:id/rules/:coreId/definition", () =>
    HttpResponse.json(sampleRuleDefinition, { headers: { "content-type": "application/json" } }),
  ),

  // Metadata
  http.get("/api/meta/run-options", () => HttpResponse.json(runOptions)),
  http.get("/api/meta/rules", () => HttpResponse.json(ruleOptions)),

  // Misc
  http.get("/api/info", () => HttpResponse.json(info)),
];

export type { CheckRunRequestT };
