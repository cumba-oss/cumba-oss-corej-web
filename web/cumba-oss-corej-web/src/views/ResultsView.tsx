import { Fragment, Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Anchor,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { awaitStatus } from "../api/checks";
import {
  artifacts as fetchArtifacts,
  conformance as fetchConformance,
  datasetGroups as fetchDatasetGroups,
  downloadLog,
  downloadReport,
  downloadReportV2,
  downloadReportXlsx,
  findings as fetchFindings,
  getLog as fetchLog,
  logLines as fetchLogLines,
  ruleDefinition as fetchRuleDefinition,
} from "../api/results";
import type {
  CheckRunStatusT,
  ConformanceResponseT,
  FileGroupT,
  FindingRowT,
  RuleDefinitionT,
  RuleExecutionEntryT,
  RunArtifactsT,
  RunLogT,
} from "../api/types";
import { DatasetBookmarks } from "../components/DatasetBookmarks";
import { formatBytes } from "../util/formatBytes";
import { formatRuntime } from "../util/formatRuntime";
import { formatTimestamp } from "../util/formatTimestamp";

/**
 * Lazy-loaded interactive JSON tree for the rule-definition modal. It is
 * modal-only UI and pulls in the `react-json-tree` bundle, so it is loaded on
 * demand rather than weighing down the initial app load.
 */
const RuleJsonView = lazy(() =>
  import("../components/RuleJsonView").then((m) => ({ default: m.RuleJsonView })),
);

/** Suspense fallback while the lazy `RuleJsonView` chunk loads. */
function RuleJsonViewLazy({ value }: { value: unknown }): React.JSX.Element {
  return (
    <Suspense fallback={<Loader size="sm" />}>
      <RuleJsonView value={value} />
    </Suspense>
  );
}

/**
 * Lazy-loaded YAML view for the rule-definition modal. Pulls in the CodeMirror
 * bundle, so — like {@link RuleJsonView} — it is loaded on demand; its tab
 * panel additionally uses `keepMounted={false}` so the chunk is fetched only
 * when the YAML tab is first opened.
 */
const RuleYamlView = lazy(() =>
  import("../components/RuleYamlView").then((m) => ({ default: m.RuleYamlView })),
);

/** Suspense fallback while the lazy `RuleYamlView` chunk loads. */
function RuleYamlViewLazy({ value }: { value: unknown }): React.JSX.Element {
  return (
    <Suspense fallback={<Loader size="sm" />}>
      <RuleYamlView value={value} />
    </Suspense>
  );
}

/** Findings page size for the drill-down "load more". */
const FINDINGS_PAGE_SIZE = 200;

/** waitSeconds for the status long-poll that observes a live run going terminal. */
const WAIT_SECONDS = 20;

/**
 * Minimum gap (ms) between successive status long-polls of the same run. The
 * server long-polls (up to {@link WAIT_SECONDS}), so this is normally a no-op;
 * it only guards a server that answers immediately from busy-looping.
 */
const MIN_POLL_INTERVAL_MS = 1000;

/** Cadence (ms) of the separate live log-line poll. */
const LIVE_POLL_INTERVAL_MS = 1000;

/**
 * Cap on the number of live log lines kept in memory / rendered. The backend
 * itself silently caps engine DEBUG/TRACE capture at 50,000 lines; we keep only
 * the most recent {@link MAX_LIVE_LINES} client-side so a long run cannot grow
 * the DOM without bound. A "showing last N" note is surfaced once it is hit.
 */
const MAX_LIVE_LINES = 5000;

/** Lifecycle states that are still in progress (so the live panel + status poll run). */
const ACTIVE_STATES: ReadonlySet<CheckRunStatusT> = new Set(["PENDING", "RUNNING"]);

function isActive(status?: CheckRunStatusT): boolean {
  return status !== undefined && ACTIVE_STATES.has(status);
}

function isTerminalStatus(status?: CheckRunStatusT): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED";
}

/** A delay that resolves after `ms`, or immediately when the signal aborts. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** True when a rule belongs to the "executed with findings" set (EXECUTED, violations > 0). */
function isFindingRule(r: RuleExecutionEntryT): boolean {
  return r.status === "EXECUTED" && (r.violations ?? 0) > 0;
}

/**
 * Partition a domain's rules into the three display groups:
 *  - group1: ERROR rows OR (EXECUTED with violations > 0)
 *  - group2: SKIPPED rows
 *  - group3: EXECUTED with 0 violations
 * Group 1 is sorted ERROR-first then violations desc; groups 2/3 by core id.
 */
interface RuleGroups {
  group1: RuleExecutionEntryT[];
  group2: RuleExecutionEntryT[];
  group3: RuleExecutionEntryT[];
  /** ERROR count in group 1. */
  errorCount: number;
  /** EXECUTED-with-findings count in group 1. */
  findingRuleCount: number;
  /** Σ violations over the finding-bearing rules (ERROR rows excluded). */
  findingTotal: number;
}

function partitionRules(rules: RuleExecutionEntryT[]): RuleGroups {
  const group1: RuleExecutionEntryT[] = [];
  const group2: RuleExecutionEntryT[] = [];
  const group3: RuleExecutionEntryT[] = [];
  for (const r of rules) {
    if (r.status === "ERROR" || isFindingRule(r)) group1.push(r);
    else if (r.status === "SKIPPED") group2.push(r);
    else if (r.status === "EXECUTED") group3.push(r);
    else group2.push(r); // any other non-executed status falls in with skipped
  }
  group1.sort((a, b) => {
    const aErr = a.status === "ERROR" ? 0 : 1;
    const bErr = b.status === "ERROR" ? 0 : 1;
    if (aErr !== bErr) return aErr - bErr;
    const byViol = (b.violations ?? 0) - (a.violations ?? 0);
    if (byViol !== 0) return byViol;
    return (a.coreId ?? "").localeCompare(b.coreId ?? "");
  });
  const byId = (a: RuleExecutionEntryT, b: RuleExecutionEntryT) =>
    (a.coreId ?? "").localeCompare(b.coreId ?? "");
  group2.sort(byId);
  group3.sort(byId);
  const errorCount = group1.filter((r) => r.status === "ERROR").length;
  const findingRules = group1.filter(isFindingRule);
  const findingTotal = findingRules.reduce((n, r) => n + (r.violations ?? 0), 0);
  return {
    group1,
    group2,
    group3,
    errorCount,
    findingRuleCount: findingRules.length,
    findingTotal,
  };
}

/** Props for {@link ResultsView}. */
export interface ResultsViewProps {
  /** The run whose results to show. */
  checkRunId: string;
  /**
   * The run's lifecycle status at open time — a STARTING HINT only. The view
   * seeds its live status from this and then long-polls `awaitStatus` to track
   * the real status: while active it streams the live log, and once terminal it
   * loads the SUCCEEDED-only result endpoints (when `SUCCEEDED`) and the
   * structured execution log (for any terminal run, so a FAILED / CANCELLED run
   * still surfaces where it broke).
   */
  status?: CheckRunStatusT;
}

/**
 * The compressed Info-block conformance fields, in order. Drops the standard
 * line (rendered specially as "Standard: …"), the Issue-limit fields, and the
 * substandard row (folded into the standard line). Timestamp formatting is
 * applied per-field below, not here.
 */
const INFO_FIELDS: ReadonlyArray<readonly [keyof ConformanceResponseT, string]> = [
  ["tigUseCase", "TIG use case"],
  ["ctVersion", "CT version"],
  ["defineXmlVersion", "Define-XML version"],
  ["coreEngineVersion", "CORE engine version"],
  ["totalRuntime", "Total runtime"],
];

/** Conformance fields that carry an ISO timestamp and so are formatted. */
const INFO_TIMESTAMP_FIELDS = new Set<keyof ConformanceResponseT>(["reportGeneration"]);

/** Lazily-loaded findings for one (file, domain, rule) drill-down. */
interface FindingsState {
  items: FindingRowT[];
  total: number;
  loading: boolean;
}

/** Composite key for a (file, domain, rule) drill-down (JSON-encoded so it is injective). */
function ruleKey(file: string, domain: string, coreId: string): string {
  return JSON.stringify([file, domain, coreId]);
}

/** Show a normalised API problem as a red notification. */
function notifyProblem(title: string, status: number, detail: string): void {
  notifications.show({ color: "red", title: `${title} (${status})`, message: detail });
}

/** Trigger a browser download of a blob under the given file name. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Non-empty configuration fields as label/value pairs for the log overlay. */
function configEntries(config: RunLogT["configuration"]): Array<[string, string]> {
  if (!config) return [];
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined || value === null) continue;
    const text = Array.isArray(value) ? value.join(", ") : String(value);
    if (text === "") continue;
    out.push([key, text]);
  }
  return out;
}

/** Compute the Info-block totals from the already-fetched dataset groups. */
function computeTotals(files: FileGroupT[]): { domainsChecked: number; findings: number } {
  let domainsChecked = 0;
  let findings = 0;
  for (const file of files) {
    for (const domain of file.domains ?? []) {
      domainsChecked += 1;
      for (const rule of domain.rules ?? []) {
        findings += rule.violations ?? 0;
      }
    }
  }
  return { domainsChecked, findings };
}

/** Identity of the rule-definition overlay's currently-open rule. */
interface RuleDefTarget {
  coreId: string;
  expandedFor?: string;
}

/**
 * Results browser: a single flat view with a two-column top block (Info +
 * Downloads) over the file → domain drill-down. The execution log opens in a
 * modal overlay; a rule's definition opens in another. The view tracks the
 * run's live status itself (the `status` prop is only a starting hint): while
 * the run is active it streams a live execution-log panel, and it swaps in the
 * full structured view once the run goes terminal.
 */
export function ResultsView({ checkRunId, status }: ResultsViewProps): React.JSX.Element {
  // The `status` prop is captured ONCE by the parent at click time and never
  // updates — so a run opened while RUNNING would otherwise never observe its
  // transition to terminal. Track our own live status, seeded from the prop, and
  // long-poll `awaitStatus` while non-terminal to observe the change. Everything
  // downstream keys off this OBSERVED status, not the prop.
  const [liveStatus, setLiveStatus] = useState<CheckRunStatusT | undefined>(status);

  // Re-seed when the parent points us at a different run (or a new starting
  // hint) — during render, React's "adjust state when a prop changes" pattern.
  const [prevStatusKey, setPrevStatusKey] = useState(`${checkRunId} ${status ?? ""}`);
  const statusKey = `${checkRunId} ${status ?? ""}`;
  if (statusKey !== prevStatusKey) {
    setPrevStatusKey(statusKey);
    setLiveStatus(status);
  }

  const succeeded = liveStatus === "SUCCEEDED";
  const terminal = isTerminalStatus(liveStatus);
  const liveActive = isActive(liveStatus);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Observe the live run going terminal. Long-poll `awaitStatus` (which only
  // reports terminal AFTER the structured log-<id>.json is persisted) so the
  // full-log fetch below is driven off a status that is safe to act on — NOT off
  // the early `/log/lines` terminal flag, which flips before persistence.
  useEffect(() => {
    if (!isActive(liveStatus)) return;
    const controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      for (;;) {
        if (!mountedRef.current || signal.aborted) return;
        const { data, problem } = await awaitStatus(checkRunId, WAIT_SECONDS);
        if (!mountedRef.current || signal.aborted) return;
        if (problem) return; // 404 (deleted) etc. — stop observing.
        if (data?.status) setLiveStatus(data.status);
        if (!data || !isActive(data.status)) return; // terminal → stop.
        await delay(MIN_POLL_INTERVAL_MS, signal);
      }
    })();
    return () => controller.abort();
  }, [checkRunId, liveStatus]);

  const [conformance, setConformance] = useState<ConformanceResponseT | null>(null);
  const [files, setFiles] = useState<FileGroupT[]>([]);
  const [artifacts, setArtifacts] = useState<RunArtifactsT | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [log, setLog] = useState<RunLogT | null>(null);
  const [openRules, setOpenRules] = useState<Set<string>>(new Set());
  const [findingsByKey, setFindingsByKey] = useState<Record<string, FindingsState>>({});

  // Per-domain collapse state for the three rule groups (keyed file|domain|group).
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  // Log overlay open flag.
  const [logOpen, setLogOpen] = useState(false);
  // Rule-definition overlay state.
  const [ruleDefTarget, setRuleDefTarget] = useState<RuleDefTarget | null>(null);
  const [ruleDef, setRuleDef] = useState<RuleDefinitionT | null>(null);
  const [ruleDefLoading, setRuleDefLoading] = useState(false);

  // Reset the result sources whenever the run or its success changes — during render (React's
  // "adjust state when a prop changes" pattern), so the load effect below only fetches. `loaded`
  // drops on every change; the SUCCEEDED-only data is cleared when the run is not succeeded.
  const resultKey = `${checkRunId} ${succeeded}`;
  const [prevResultKey, setPrevResultKey] = useState(resultKey);
  if (resultKey !== prevResultKey) {
    setPrevResultKey(resultKey);
    setLoaded(false);
    if (!succeeded) {
      setConformance(null);
      setFiles([]);
      setArtifacts(null);
      setOpenRules(new Set());
      setFindingsByKey({});
      setOpenGroups({});
    }
  }

  // Load the SUCCEEDED-only result sources. setState lives in the .then callback so the effect
  // never updates state synchronously.
  useEffect(() => {
    if (!succeeded) return;
    let active = true;
    void Promise.all([
      fetchConformance(checkRunId),
      fetchDatasetGroups(checkRunId),
      fetchArtifacts(checkRunId),
    ]).then(([c, g, a]) => {
      if (!active) return;
      if (c.problem) notifyProblem("Could not load infos", c.problem.status, c.problem.detail);
      else setConformance(c.data ?? null);
      if (g.problem) notifyProblem("Could not load datasets", g.problem.status, g.problem.detail);
      else setFiles(g.data ?? []);
      if (!a.problem) setArtifacts(a.data ?? null);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [checkRunId, succeeded]);

  // The execution log loads for any terminal run, not just SUCCEEDED. Clear it when the run is not
  // terminal — during render, matching the pattern above.
  const logKey = `${checkRunId} ${terminal}`;
  const [prevLogKey, setPrevLogKey] = useState(logKey);
  if (logKey !== prevLogKey) {
    setPrevLogKey(logKey);
    if (!terminal) setLog(null);
  }
  useEffect(() => {
    if (!terminal) return;
    let active = true;
    void (async () => {
      // Belt-and-suspenders: the status long-poll only reports terminal after the
      // structured log-<id>.json is persisted, so this should normally succeed. If
      // it races a 409 ("no execution log yet"), retry once after a short delay.
      let result = await fetchLog(checkRunId);
      if (active && result.problem?.status === 409) {
        await new Promise((r) => setTimeout(r, LIVE_POLL_INTERVAL_MS));
        if (!active) return;
        result = await fetchLog(checkRunId);
      }
      if (active) setLog(result.data ?? null);
    })();
    return () => {
      active = false;
    };
  }, [checkRunId, terminal]);

  // Live execution-log lines streamed while the run is active (PENDING/RUNNING).
  // Polled on its own ~1s timer, independent of the status long-poll above.
  const [liveLines, setLiveLines] = useState<string[]>([]);
  const [liveTruncated, setLiveTruncated] = useState(false);

  // Reset the live buffer whenever the run changes or it goes terminal — during
  // render, matching the patterns above.
  const liveKey = `${checkRunId} ${liveActive}`;
  const [prevLiveKey, setPrevLiveKey] = useState(liveKey);
  if (liveKey !== prevLiveKey) {
    setPrevLiveKey(liveKey);
    setLiveLines([]);
    setLiveTruncated(false);
  }

  useEffect(() => {
    if (!liveActive) return;
    const controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      let from = 0;
      for (;;) {
        if (!mountedRef.current || signal.aborted) return;
        const { data, problem } = await fetchLogLines(checkRunId, from);
        if (!mountedRef.current || signal.aborted) return;
        if (problem) return; // 404 (deleted) — stop streaming.
        if (data) {
          const newLines = data.lines ?? [];
          if (newLines.length > 0) {
            setLiveLines((prev) => {
              const merged = [...prev, ...newLines];
              if (merged.length > MAX_LIVE_LINES) {
                setLiveTruncated(true);
                return merged.slice(merged.length - MAX_LIVE_LINES);
              }
              return merged;
            });
          }
          from = data.nextFrom ?? from;
          // The `/log/lines` terminal flag is an EARLY signal — fine for STOPPING
          // the line poll, but it must NOT drive the full-log fetch (that is gated
          // on the status long-poll above, after persistence).
          if (data.terminal) return;
        }
        await delay(LIVE_POLL_INTERVAL_MS, signal);
      }
    })();
    return () => controller.abort();
  }, [checkRunId, liveActive]);

  // Load (or append) a page of findings for one rule of one dataset.
  const loadFindings = useCallback(
    async (file: string, domain: string, coreId: string, firstIndex: number) => {
      const key = ruleKey(file, domain, coreId);
      setFindingsByKey((prev) => ({
        ...prev,
        [key]: { items: prev[key]?.items ?? [], total: prev[key]?.total ?? 0, loading: true },
      }));
      const { data, problem } = await fetchFindings(checkRunId, {
        file,
        domain,
        coreId,
        firstIndex,
        count: FINDINGS_PAGE_SIZE,
      });
      if (problem || !data) {
        notifyProblem("Could not load findings", problem?.status ?? 0, problem?.detail ?? "Empty");
        setFindingsByKey((prev) => ({
          ...prev,
          [key]: { items: prev[key]?.items ?? [], total: prev[key]?.total ?? 0, loading: false },
        }));
        return;
      }
      setFindingsByKey((prev) => {
        const existing = firstIndex === 0 ? [] : (prev[key]?.items ?? []);
        const merged = [...existing, ...(data.items ?? [])];
        return {
          ...prev,
          [key]: { items: merged, total: data.total ?? merged.length, loading: false },
        };
      });
    },
    [checkRunId],
  );

  // Expand / collapse a rule's findings; first expand kicks off the initial page.
  const toggleRule = useCallback(
    (file: string, domain: string, coreId: string) => {
      const key = ruleKey(file, domain, coreId);
      const willOpen = !openRules.has(key);
      setOpenRules((prev) => {
        const next = new Set(prev);
        if (willOpen) next.add(key);
        else next.delete(key);
        return next;
      });
      if (willOpen && !findingsByKey[key]) void loadFindings(file, domain, coreId, 0);
    },
    [openRules, findingsByKey, loadFindings],
  );

  // Open the rule-definition overlay and fetch the definition.
  const openRuleDef = useCallback(
    (coreId: string, expandedFor?: string) => {
      setRuleDefTarget({ coreId, expandedFor });
      setRuleDef(null);
      setRuleDefLoading(true);
      void fetchRuleDefinition(checkRunId, coreId).then(({ data, problem }) => {
        setRuleDefLoading(false);
        if (problem || !data) {
          notifyProblem(
            "Could not load rule definition",
            problem?.status ?? 0,
            problem?.detail ?? "Empty",
          );
          return;
        }
        setRuleDef(data);
      });
    },
    [checkRunId],
  );

  const handleDownloadLog = useCallback(async () => {
    const { data, problem } = await downloadLog(checkRunId);
    if (problem || !data) {
      notifyProblem("Could not download log", problem?.status ?? 0, problem?.detail ?? "Empty");
      return;
    }
    saveBlob(data, `log-${checkRunId}.json`);
  }, [checkRunId]);

  const handleDownload = useCallback(async () => {
    const { data, problem } = await downloadReport(checkRunId);
    if (problem || !data) {
      notifyProblem("Could not download report", problem?.status ?? 0, problem?.detail ?? "Empty");
      return;
    }
    saveBlob(data, `report-${checkRunId}.json`);
  }, [checkRunId]);

  const handleDownloadV2 = useCallback(async () => {
    const { data, problem } = await downloadReportV2(checkRunId);
    if (problem || !data) {
      notifyProblem(
        "Could not download combined report",
        problem?.status ?? 0,
        problem?.detail ?? "Empty",
      );
      return;
    }
    saveBlob(data, `report-${checkRunId}.v2.json`);
  }, [checkRunId]);

  const handleDownloadXlsx = useCallback(async () => {
    const { data, problem } = await downloadReportXlsx(checkRunId);
    if (problem || !data) {
      notifyProblem("Could not download report", problem?.status ?? 0, problem?.detail ?? "Empty");
      return;
    }
    saveBlob(data, `report-${checkRunId}.xlsx`);
  }, [checkRunId]);

  const toggleGroup = useCallback((key: string, fallbackOpen: boolean) => {
    setOpenGroups((prev) => ({ ...prev, [key]: !(prev[key] ?? fallbackOpen) }));
  }, []);

  if (!terminal) {
    // An active run streams its execution log live until it goes terminal, when
    // the effects above swap in the full RunLog overlay. A run with no usable
    // status falls back to the original notice.
    if (liveActive) {
      return (
        <Stack gap="md">
          <Title order={4}>Results — {checkRunId}</Title>
          <Alert color="blue" title={`Run ${liveStatus?.toLowerCase() ?? "in progress"}`}>
            Streaming the live execution log. The full results and structured log appear once the
            run finishes.
          </Alert>
          <Stack gap="xs">
            <Group justify="space-between">
              <Title order={5}>Live log</Title>
              <Group gap="xs">
                <Loader size="xs" />
                <Text size="xs" c="dimmed">
                  {liveLines.length} line{liveLines.length === 1 ? "" : "s"}
                </Text>
              </Group>
            </Group>
            {liveTruncated && (
              <Text size="xs" c="dimmed">
                Showing the last {MAX_LIVE_LINES} lines (the log may be truncated at 50,000 lines).
              </Text>
            )}
            <LogLines lines={liveLines} autoScroll placeholder="Waiting for log output…" />
          </Stack>
        </Stack>
      );
    }
    return (
      <Alert color="yellow" title="Results not available">
        Results and the execution log are available once a run is terminal. This run is{" "}
        <Text span fw={600}>
          {liveStatus ?? "UNKNOWN"}
        </Text>
        .
      </Alert>
    );
  }

  const bookmarks = files.map((f) => ({ key: f.fileName ?? "", label: f.fileName ?? "—" }));
  const generatedAt = formatTimestamp(
    artifacts?.generatedAt ?? conformance?.reportGeneration ?? undefined,
  );
  const totals = computeTotals(files);

  // The substandard is DERIVED server-side (the declared TIG leg) and shown, never entered:
  // there is no substandard control on the run form and nothing here branches on the value.
  const standardLine = conformance
    ? `${conformance.standard ?? "—"}${conformance.version ? ` ${conformance.version}` : ""}${
        conformance.substandard ? ` (${conformance.substandard})` : ""
      }`
    : "—";

  return (
    <Stack gap="md">
      <Title order={4}>Results — {checkRunId}</Title>

      {!succeeded && log?.failureMessage && (
        <Alert color="red" title={`Run ${liveStatus?.toLowerCase() ?? "did not succeed"}`}>
          {log.failureMessage}
        </Alert>
      )}

      {/* Degradation basis lines (Fix #369 / PLAN-dictionary-seeder D13): the server sends these
          ONLY when rules could not be answered — a run that validated nothing must never read as
          clean. Rendered as a callout ABOVE the metadata table, not as two more Info rows: a
          degradation note formatted like every other row is exactly what gets skimmed past. */}
      {conformance && (conformance.libraryMetadataBasis || conformance.dictionaryBasis) && (
        <Alert color="orange" title="Degraded run — some rules could not be answered">
          <Stack gap={4}>
            {conformance.libraryMetadataBasis && (
              <Text size="sm">Library metadata basis: {conformance.libraryMetadataBasis}</Text>
            )}
            {conformance.dictionaryBasis && (
              <Text size="sm">Dictionary basis: {conformance.dictionaryBasis}</Text>
            )}
          </Stack>
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        {/* Info (compressed). */}
        <Stack gap={4}>
          <Text size="sm" fw={600}>
            Info
          </Text>
          {conformance ? (
            <Table withTableBorder>
              <Table.Tbody>
                <Table.Tr>
                  <Table.Th>Standard</Table.Th>
                  <Table.Td>{standardLine}</Table.Td>
                </Table.Tr>
                {INFO_FIELDS.map(([key, label]) => (
                  <Table.Tr key={key}>
                    <Table.Th>{label}</Table.Th>
                    <Table.Td>{conformance[key] ?? "—"}</Table.Td>
                  </Table.Tr>
                ))}
                <Table.Tr>
                  <Table.Th>Report generated</Table.Th>
                  <Table.Td>
                    {INFO_TIMESTAMP_FIELDS.has("reportGeneration")
                      ? formatTimestamp(conformance.reportGeneration ?? undefined)
                      : (conformance.reportGeneration ?? "—")}
                  </Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Th>Number of Domains Checked</Table.Th>
                  <Table.Td>{totals.domainsChecked}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Th>Number of Findings</Table.Th>
                  <Table.Td>{totals.findings}</Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
          ) : succeeded && !loaded ? (
            <Group>
              <Loader size="sm" />
              <Text>Loading infos…</Text>
            </Group>
          ) : (
            <Text c="dimmed">No conformance data available.</Text>
          )}
        </Stack>

        {/* Downloads. */}
        <Stack gap={4}>
          <Text size="sm" fw={600}>
            Downloads
          </Text>
          <Table withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Download</Table.Th>
                <Table.Th>Size</Table.Th>
                <Table.Th>Generated</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              <Table.Tr>
                <Table.Td>
                  {succeeded ? (
                    <Anchor component="button" type="button" onClick={() => void handleDownload()}>
                      Report (JSON)
                    </Anchor>
                  ) : (
                    <Text c="dimmed">Report (JSON)</Text>
                  )}
                </Table.Td>
                <Table.Td>
                  {artifacts?.reportBytes != null ? formatBytes(artifacts.reportBytes) : "—"}
                </Table.Td>
                <Table.Td>{generatedAt}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>
                  {succeeded ? (
                    <Anchor
                      component="button"
                      type="button"
                      onClick={() => void handleDownloadV2()}
                    >
                      Combined report (v2 JSON)
                    </Anchor>
                  ) : (
                    <Text c="dimmed">Combined report (v2 JSON)</Text>
                  )}
                </Table.Td>
                <Table.Td>
                  {artifacts?.reportV2Bytes != null ? formatBytes(artifacts.reportV2Bytes) : "—"}
                </Table.Td>
                <Table.Td>{generatedAt}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>
                  {succeeded ? (
                    <Anchor
                      component="button"
                      type="button"
                      onClick={() => void handleDownloadXlsx()}
                    >
                      Report (Excel)
                    </Anchor>
                  ) : (
                    <Text c="dimmed">Report (Excel)</Text>
                  )}
                </Table.Td>
                <Table.Td>
                  {artifacts?.reportXlsxBytes != null
                    ? formatBytes(artifacts.reportXlsxBytes)
                    : "—"}
                </Table.Td>
                <Table.Td>{generatedAt}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>
                  <Group gap="xs">
                    {log ? (
                      <Anchor
                        component="button"
                        type="button"
                        onClick={() => void handleDownloadLog()}
                      >
                        Execution log
                      </Anchor>
                    ) : (
                      <Text c="dimmed">Execution log</Text>
                    )}
                    {log && (
                      <Button size="compact-xs" variant="light" onClick={() => setLogOpen(true)}>
                        View log
                      </Button>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>
                  {artifacts?.logBytes != null ? formatBytes(artifacts.logBytes) : "—"}
                </Table.Td>
                <Table.Td>{generatedAt}</Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
        </Stack>
      </SimpleGrid>

      {/* Datasets drill-down. */}
      {succeeded && (
        <Group align="flex-start" wrap="nowrap" gap="md">
          <DatasetBookmarks datasets={bookmarks} anchorId={(k) => `file-${k}`} />
          <Stack gap="lg" style={{ flex: 1 }}>
            {files.map((file) => (
              <Card key={file.fileName} withBorder padding="md" id={`file-${file.fileName ?? ""}`}>
                <Stack gap="sm">
                  <Title order={4}>{file.fileName}</Title>
                  <Group gap="lg">
                    <Text size="sm">
                      <Text span fw={600}>
                        Size:
                      </Text>{" "}
                      {file.sizeBytes != null ? formatBytes(file.sizeBytes) : "—"}
                    </Text>
                    <Text size="sm">
                      <Text span fw={600}>
                        Modified:
                      </Text>{" "}
                      {formatTimestamp(file.modificationDate ?? undefined)}
                    </Text>
                    <Text size="sm" style={{ wordBreak: "break-all" }}>
                      <Text span fw={600}>
                        SHA-256:
                      </Text>{" "}
                      {file.sha256 ?? "—"}
                    </Text>
                  </Group>

                  {(file.domains ?? []).length === 0 ? (
                    <Text size="sm" c="dimmed">
                      No datasets validated in this file.
                    </Text>
                  ) : (
                    (file.domains ?? []).map((domain) => {
                      const f = file.fileName ?? "";
                      const d = domain.domain ?? "";
                      const groups = partitionRules(domain.rules ?? []);
                      const g1Headline = `${groups.errorCount + groups.findingRuleCount} rules executed with ${groups.findingTotal} findings or ERRORs`;
                      // Engine error detail for this (file, domain), keyed by rule id — surfaced in
                      // the ERROR-row Note cell so a failed rule shows why without opening the log.
                      const errorMessages: Record<string, string> = {};
                      for (const dl of log?.domains ?? []) {
                        const sameDomain = (dl.domain ?? "") === d;
                        const sameFile = !dl.fileName || dl.fileName === f;
                        if (sameDomain && sameFile) {
                          for (const e of dl.errors ?? []) {
                            if (e.ruleId) errorMessages[e.ruleId] = e.message ?? "";
                          }
                        }
                      }
                      return (
                        <Paper
                          key={domain.domain}
                          withBorder
                          p="sm"
                          style={{ borderLeft: "3px solid var(--mantine-color-blue-4)" }}
                        >
                          <Stack gap="xs">
                            <Title order={5}>
                              {domain.domain}
                              {domain.label ? ` — ${domain.label}` : ""}
                            </Title>
                            <Group gap="lg">
                              <Text size="xs" c="dimmed">
                                Rows: {domain.rows ?? "—"}
                              </Text>
                              <Text size="xs" c="dimmed">
                                Columns: {domain.columns ?? "—"}
                              </Text>
                              <Text size="xs" c="dimmed">
                                Runtime: {formatRuntime(domain.runtimeMillis)}
                              </Text>
                            </Group>

                            {groups.group1.length === 0 &&
                              groups.group2.length === 0 &&
                              groups.group3.length === 0 && (
                                <Text size="sm" c="dimmed">
                                  No rule outcomes recorded for this domain.
                                </Text>
                              )}

                            {groups.group1.length > 0 && (
                              <RuleGroup
                                groupKey={`${f}|${d}|1`}
                                headline={g1Headline}
                                rules={groups.group1}
                                defaultOpen={true}
                                open={openGroups[`${f}|${d}|1`] ?? true}
                                onToggle={() => toggleGroup(`${f}|${d}|1`, true)}
                                file={f}
                                domain={d}
                                openRules={openRules}
                                findingsByKey={findingsByKey}
                                onToggleRule={toggleRule}
                                onLoadMore={loadFindings}
                                onOpenRuleDef={openRuleDef}
                                errorMessages={errorMessages}
                              />
                            )}
                            {groups.group2.length > 0 && (
                              <RuleGroup
                                groupKey={`${f}|${d}|2`}
                                headline={`${groups.group2.length} rules skipped`}
                                rules={groups.group2}
                                defaultOpen={false}
                                open={openGroups[`${f}|${d}|2`] ?? false}
                                onToggle={() => toggleGroup(`${f}|${d}|2`, false)}
                                file={f}
                                domain={d}
                                openRules={openRules}
                                findingsByKey={findingsByKey}
                                onToggleRule={toggleRule}
                                onLoadMore={loadFindings}
                                onOpenRuleDef={openRuleDef}
                              />
                            )}
                            {groups.group3.length > 0 && (
                              <RuleGroup
                                groupKey={`${f}|${d}|3`}
                                headline={`${groups.group3.length} rules executed without findings`}
                                rules={groups.group3}
                                defaultOpen={false}
                                open={openGroups[`${f}|${d}|3`] ?? false}
                                onToggle={() => toggleGroup(`${f}|${d}|3`, false)}
                                file={f}
                                domain={d}
                                openRules={openRules}
                                findingsByKey={findingsByKey}
                                onToggleRule={toggleRule}
                                onLoadMore={loadFindings}
                                onOpenRuleDef={openRuleDef}
                              />
                            )}
                          </Stack>
                        </Paper>
                      );
                    })
                  )}
                </Stack>
              </Card>
            ))}
            {files.length === 0 && loaded && <Text c="dimmed">No files.</Text>}
          </Stack>
        </Group>
      )}

      {/* Log overlay. */}
      <Modal
        opened={logOpen}
        onClose={() => setLogOpen(false)}
        title="Execution log"
        size="xl"
        withCloseButton
      >
        {logOpen && <LogOverlay log={log} />}
      </Modal>

      {/* Rule-definition overlay. */}
      <Modal
        opened={ruleDefTarget !== null}
        onClose={() => setRuleDefTarget(null)}
        title={
          ruleDefTarget
            ? `Rule ${ruleDefTarget.coreId}${
                ruleDefTarget.expandedFor ? ` (expanded for ${ruleDefTarget.expandedFor})` : ""
              }`
            : "Rule definition"
        }
        size="xl"
        withCloseButton
        styles={{
          // Make the overlay user-resizable: a native drag-grip on the
          // content's bottom-right corner. The content is a flex column so the
          // body (and the rule view inside it) fills the resized height.
          content: {
            resize: "both",
            overflow: "hidden",
            height: "70vh",
            minWidth: 480,
            minHeight: 320,
            maxWidth: "95vw",
            maxHeight: "90vh",
            display: "flex",
            flexDirection: "column",
          },
          body: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" },
        }}
      >
        {ruleDefTarget !== null && <RuleDefOverlay loading={ruleDefLoading} def={ruleDef} />}
      </Modal>
    </Stack>
  );
}

/**
 * The rule-definition modal body: loading state, then the rule rendered as
 * JSON / YAML tabs. The rule shown is the materialized (expanded) rule when
 * present, otherwise the source rule — the source-template view is
 * intentionally not surfaced separately.
 */
function RuleDefOverlay({
  loading,
  def,
}: {
  loading: boolean;
  def: RuleDefinitionT | null;
}): React.JSX.Element {
  if (loading) {
    return (
      <Group gap="xs">
        <Loader size="sm" />
        <Text>Loading rule definition…</Text>
      </Group>
    );
  }
  if (!def) {
    return <Text c="dimmed">No rule definition available.</Text>;
  }
  const value = def.expanded ?? def.source ?? null;
  // Fill the resizable modal's height: the Tabs root is a flex column, and the
  // active panel grows to fill it (`panelFill`). The panel keeps Mantine's own
  // `display` so the inactive panel stays hidden — we only add flex sizing.
  // `minHeight: 0` lets the inner scroller shrink instead of overflowing.
  const tabsFill = { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } as const;
  const panelFill = { flex: 1, minHeight: 0 } as const;
  return (
    <Tabs defaultValue="json" style={tabsFill}>
      <Tabs.List>
        <Tabs.Tab value="json">JSON</Tabs.Tab>
        <Tabs.Tab value="yaml">YAML</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="json" pt="sm" style={panelFill}>
        <RuleJsonViewLazy value={value} />
      </Tabs.Panel>
      {/* keepMounted={false}: defer the CodeMirror bundle until the YAML tab is opened. */}
      <Tabs.Panel value="yaml" pt="sm" keepMounted={false} style={panelFill}>
        <RuleYamlViewLazy value={value} />
      </Tabs.Panel>
    </Tabs>
  );
}

/** Props shared by the three rule groups. */
interface RuleGroupProps {
  groupKey: string;
  headline: string;
  rules: RuleExecutionEntryT[];
  defaultOpen: boolean;
  open: boolean;
  onToggle: () => void;
  file: string;
  domain: string;
  openRules: Set<string>;
  findingsByKey: Record<string, FindingsState>;
  onToggleRule: (file: string, domain: string, coreId: string) => void;
  onLoadMore: (file: string, domain: string, coreId: string, firstIndex: number) => Promise<void>;
  onOpenRuleDef: (coreId: string, expandedFor?: string) => void;
  /** Error detail keyed by rule id (coreId / generatedId), for the ERROR-row Note cell. */
  errorMessages?: Record<string, string>;
}

/** One collapsible rule group (headline + chevron + rules table). */
function RuleGroup(props: RuleGroupProps): React.JSX.Element {
  const {
    headline,
    rules,
    open,
    onToggle,
    file,
    domain,
    openRules,
    findingsByKey,
    onToggleRule,
    onLoadMore,
    onOpenRuleDef,
    errorMessages = {},
  } = props;
  return (
    <Stack gap={4}>
      <Anchor component="button" type="button" onClick={onToggle} style={{ textAlign: "left" }}>
        <Text span fw={600} size="sm">
          {open ? "▾" : "▸"} {headline}
        </Text>
      </Anchor>
      {open && (
        <Table striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Rule</Table.Th>
              <Table.Th>Description</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Violations</Table.Th>
              <Table.Th>Runtime</Table.Th>
              <Table.Th>Note</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rules.map((r, i) => {
              const cid = r.coreId ?? "";
              const key = ruleKey(file, domain, cid);
              const isOpen = openRules.has(key);
              const state = findingsByKey[key];
              const violations = r.violations ?? 0;
              // ERROR rows show why they failed (the engine error message, joined from the run
              // log by rule id). Description (what the rule checks) stays in its own column.
              const errorMessage =
                r.status === "ERROR"
                  ? (errorMessages[cid] ??
                    (r.generatedId ? errorMessages[r.generatedId] : undefined))
                  : undefined;
              const note = errorMessage ?? r.notExecutedReason ?? r.executability ?? "—";
              return (
                <Fragment key={`${r.generatedId ?? cid}-${i}`}>
                  <Table.Tr>
                    <Table.Td>
                      <Anchor
                        component="button"
                        type="button"
                        onClick={() => onOpenRuleDef(cid, r.expandedFor ?? undefined)}
                      >
                        {r.coreId}
                      </Anchor>
                    </Table.Td>
                    <Table.Td>{r.description ?? "—"}</Table.Td>
                    <Table.Td>{r.status}</Table.Td>
                    <Table.Td>
                      {violations > 0 ? (
                        <Anchor
                          component="button"
                          type="button"
                          onClick={() => onToggleRule(file, domain, cid)}
                        >
                          {violations}
                          {isOpen ? " ▾" : " ▸"}
                        </Anchor>
                      ) : (
                        violations
                      )}
                    </Table.Td>
                    <Table.Td>{formatRuntime(r.runtimeMillis)}</Table.Td>
                    <Table.Td>{note}</Table.Td>
                  </Table.Tr>
                  {isOpen && (
                    <Table.Tr>
                      <Table.Td colSpan={6}>
                        <FindingsPanel
                          state={state}
                          onLoadMore={() =>
                            void onLoadMore(file, domain, cid, state?.items.length ?? 0)
                          }
                        />
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Fragment>
              );
            })}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}

/** The structured log overlay body (former Logs-tab content, sans file manifest). */
function LogOverlay({ log }: { log: RunLogT | null }): React.JSX.Element {
  if (!log) {
    return <Text c="dimmed">No execution log available for this run.</Text>;
  }
  const errs = (log.domains ?? []).flatMap((d) =>
    (d.errors ?? []).map((e) => ({ domain: d.domain, ...e })),
  );
  const notExecuted = (log.domains ?? []).flatMap((d) =>
    (d.ruleExecutions ?? [])
      .filter((r) => r.status !== "EXECUTED")
      .map((r) => ({ domain: d.domain, ...r })),
  );
  return (
    <Stack gap="md">
      {log.failureMessage && (
        <Alert color="red" title="Run failed">
          {log.failureMessage}
        </Alert>
      )}

      <Stack gap="xs">
        <Title order={5}>Configuration</Title>
        <Table withTableBorder>
          <Table.Tbody>
            {configEntries(log.configuration).map(([key, value]) => (
              <Table.Tr key={key}>
                <Table.Th>{key}</Table.Th>
                <Table.Td>{value}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Stack>

      <Stack gap="xs">
        <Title order={5}>Domains</Title>
        <Table striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Domain</Table.Th>
              <Table.Th>File</Table.Th>
              <Table.Th>Rules (X of Y)</Table.Th>
              <Table.Th>Findings</Table.Th>
              <Table.Th>Runtime</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(log.domains ?? []).map((domain, i) => (
              <Table.Tr key={`${domain.domain ?? ""}-${i}`}>
                <Table.Td>{domain.domain}</Table.Td>
                <Table.Td>{domain.fileName}</Table.Td>
                <Table.Td>
                  {domain.rulesExecuted} of {domain.rulesTotal}
                </Table.Td>
                <Table.Td>{domain.findings}</Table.Td>
                <Table.Td>{formatRuntime(domain.runtimeMillis)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Stack>

      <Stack gap="xs">
        <Title order={5}>Errors</Title>
        {errs.length === 0 ? (
          <Text size="sm" c="dimmed">
            No errors recorded.
          </Text>
        ) : (
          <Table striped withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Domain</Table.Th>
                <Table.Th>Rule</Table.Th>
                <Table.Th>Message</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {errs.map((e, i) => (
                <Table.Tr key={`${e.domain ?? ""}-${e.ruleId ?? ""}-${i}`}>
                  <Table.Td>{e.domain}</Table.Td>
                  <Table.Td>{e.ruleId}</Table.Td>
                  <Table.Td>{e.message}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>

      <Stack gap="xs">
        <Title order={5}>Rules not executed</Title>
        {notExecuted.length === 0 ? (
          <Text size="sm" c="dimmed">
            Every rule executed.
          </Text>
        ) : (
          <Table striped withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Domain</Table.Th>
                <Table.Th>Rule</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Reason</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {notExecuted.map((r, i) => (
                <Table.Tr key={`${r.domain ?? ""}-${r.coreId ?? ""}-${i}`}>
                  <Table.Td>{r.domain}</Table.Td>
                  <Table.Td>{r.coreId}</Table.Td>
                  <Table.Td>{r.status}</Table.Td>
                  <Table.Td>{r.notExecutedReason ?? "—"}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>

      {(log.logLines ?? []).length > 0 && (
        <Stack gap="xs">
          <Title order={5}>Engine log</Title>
          <LogLines lines={log.logLines ?? []} />
        </Stack>
      )}
    </Stack>
  );
}

/**
 * A lightweight monospace log panel: one line per row inside a single scroll
 * box (NOT a growing Mantine `Table`), so a long live log re-renders cheaply.
 * With `autoScroll`, it keeps the viewport pinned to the bottom as new lines
 * arrive (unless the user has scrolled up). Shared by the live panel and the
 * structured log overlay's "Engine log" block.
 */
function LogLines({
  lines,
  autoScroll = false,
  placeholder,
}: {
  lines: readonly string[];
  autoScroll?: boolean;
  placeholder?: string;
}): React.JSX.Element {
  const boxRef = useRef<HTMLPreElement>(null);
  // Track whether the user is pinned to the bottom; only auto-scroll then, so a
  // manual scroll-up to read earlier output is not yanked back down.
  const pinnedRef = useRef(true);
  const onScroll = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }, []);
  useEffect(() => {
    if (!autoScroll) return;
    const el = boxRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [autoScroll, lines]);

  if (lines.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        {placeholder ?? "No log output."}
      </Text>
    );
  }
  return (
    <pre
      ref={boxRef}
      onScroll={onScroll}
      style={{
        margin: 0,
        maxHeight: 360,
        overflow: "auto",
        fontFamily: "monospace",
        fontSize: "0.75rem",
        lineHeight: 1.4,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        border: "1px solid var(--mantine-color-gray-3)",
        borderRadius: "var(--mantine-radius-sm)",
        padding: "0.5rem 0.75rem",
        background: "var(--mantine-color-gray-0)",
      }}
    >
      {lines.join("\n")}
    </pre>
  );
}

/**
 * Zip a finding's positional `variables`/`values` into "NAME = value" pairs and
 * join them for the Variables column. Returns "—" when no variables are reported.
 */
function formatVariables(f: FindingRowT): string {
  const names = f.variables ?? [];
  if (names.length === 0) return "—";
  const vals = f.values ?? [];
  return names.map((name, i) => `${name} = ${vals[i] ?? ""}`).join(", ");
}

/**
 * "QNAM = AESOSP, IDVARVAL = 3" — the EC-40 record key that identifies this row beyond
 * USUBJID/Seq, or "" when none resolved. Every resolved key renders identically: the
 * `keySource` tier rides on the DTO but is deliberately not surfaced here (plan decision D10).
 */
function formatKeys(f: FindingRowT): string {
  const names = f.keyVariables ?? [];
  if (names.length === 0) return "";
  const keys = f.keys ?? {};
  return names.map((n) => `${n} = ${keys[n] ?? ""}`).join(", ");
}

/** The lazily-loaded, paged findings of one rule, shown under its rules-table row. */
function FindingsPanel({
  state,
  onLoadMore,
}: {
  state: FindingsState | undefined;
  onLoadMore: () => void;
}): React.JSX.Element {
  if (!state || (state.loading && state.items.length === 0)) {
    return (
      <Group gap="xs" py="xs">
        <Loader size="xs" />
        <Text size="sm">Loading findings…</Text>
      </Group>
    );
  }
  if (state.items.length === 0) {
    return (
      <Text size="sm" c="dimmed" py="xs">
        No findings.
      </Text>
    );
  }
  // The finding message is identical for every row of one rule's drill-down (the engine sets one
  // message per rule execution), so it is shown once above the table rather than per row.
  const message = state.items.find((f) => f.message)?.message;
  // The Key column is rendered only when at least one loaded row carries a record key, so a run
  // executed under the default `corej.findingKeys=off` shows exactly the table it always did.
  const showKeys = state.items.some((f) => (f.keyVariables ?? []).length > 0);
  return (
    <Stack gap={4} py="xs">
      {message && (
        <Text size="sm" fw={500}>
          {message}
        </Text>
      )}
      <Table striped withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Row</Table.Th>
            <Table.Th>USUBJID</Table.Th>
            <Table.Th>Seq</Table.Th>
            {showKeys && <Table.Th>Key</Table.Th>}
            <Table.Th>Variables</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {state.items.map((f, i) => (
            <Table.Tr key={`${f.usubjid ?? ""}-${f.row ?? ""}-${i}`}>
              <Table.Td>{f.row}</Table.Td>
              <Table.Td>{f.usubjid}</Table.Td>
              <Table.Td>{f.seq}</Table.Td>
              {showKeys && (
                <Table.Td style={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>
                  {formatKeys(f)}
                </Table.Td>
              )}
              <Table.Td style={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>
                {formatVariables(f)}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {state.items.length < state.total && (
        <Button
          size="xs"
          variant="subtle"
          loading={state.loading}
          onClick={onLoadMore}
          style={{ alignSelf: "flex-start" }}
        >
          Load more ({state.items.length} of {state.total})
        </Button>
      )}
    </Stack>
  );
}
