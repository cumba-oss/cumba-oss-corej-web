import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Group, Loader, Stack, Table, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { awaitStatus, cancelCheck, deleteCheck, listChecks } from "../api/checks";
import type { CheckRunStatusT, CheckStatusT } from "../api/types";
import { StatusBadge } from "../components/StatusBadge";
import { formatTimestamp } from "../util/formatTimestamp";

/** waitSeconds for the long-poll: the server holds the request up to this long. */
const WAIT_SECONDS = 20;

/**
 * Minimum gap (ms) between successive polls of the same run. The server
 * long-polls (up to {@link WAIT_SECONDS}), so this is normally a no-op; it
 * only guards against a server that answers immediately, preventing a tight
 * busy-loop that would starve the event loop.
 */
const MIN_POLL_INTERVAL_MS = 1000;

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

/** Lifecycle states that are still in progress (and therefore polled). */
const ACTIVE_STATES: ReadonlySet<CheckRunStatusT> = new Set(["PENDING", "RUNNING"]);

function isActive(status?: CheckRunStatusT): boolean {
  return status !== undefined && ACTIVE_STATES.has(status);
}

/** Props for {@link RunsView}. */
export interface RunsViewProps {
  /** When set, list only runs for this session (`GET /api/checks?sessionId=`). */
  sessionId?: string;
  /**
   * Called with a run's id and status when the user opens it. Invoked for any
   * terminal run (`SUCCEEDED` / `FAILED` / `CANCELLED`) — a SUCCEEDED run has the
   * full results, a FAILED / CANCELLED run still exposes its execution log — and
   * for an active (`PENDING` / `RUNNING`) run, which opens a live-log view. The
   * status is only a starting hint; {@link import("./ResultsView").ResultsView}
   * tracks the run's live status itself. The parent renders that view.
   */
  onSelectRun?: (checkRunId: string, status: CheckRunStatusT) => void;
}

/** Terminal states that have a results/log view to open. */
const TERMINAL_STATES: ReadonlySet<CheckRunStatusT> = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

/**
 * Runs dashboard. Lists run snapshots (`GET /api/checks[?sessionId=]`) and,
 * for every `PENDING`/`RUNNING` row, long-polls
 * `GET /api/checks/{id}/status?waitSeconds=20`, merging each snapshot back
 * into the row. Polling for a run STOPS the moment it reaches a terminal
 * status, and ALL in-flight polls are aborted on unmount (no leaked timers,
 * no setState-after-unmount). Per-row Cancel / Delete actions are provided;
 * a `SUCCEEDED` row exposes "View results", a terminal non-succeeded row "View
 * log", and an active (`PENDING`/`RUNNING`) row "Live log" — all →
 * {@link RunsViewProps.onSelectRun}.
 */
export function RunsView({ sessionId, onSelectRun }: RunsViewProps): React.JSX.Element {
  const [runs, setRuns] = useState<CheckStatusT[]>([]);
  const [loading, setLoading] = useState(true);

  // Live-ness guard + the set of run ids currently being polled, so a run is
  // never polled twice and so callbacks can bail after unmount.
  const mountedRef = useRef(true);
  const pollingRef = useRef<Set<string>>(new Set());
  const controllersRef = useRef<Map<string, AbortController>>(new Map());

  // Mirror of `runs` for the list-discovery interval, so the interval can read
  // the latest list without being re-created on every render. Updated in an effect (not during
  // render) to satisfy react-hooks/refs.
  const runsRef = useRef<CheckStatusT[]>(runs);
  useEffect(() => {
    runsRef.current = runs;
  });

  const upsertRun = useCallback((snapshot: CheckStatusT) => {
    setRuns((prev) => {
      const idx = prev.findIndex((r) => r.checkRunId === snapshot.checkRunId);
      if (idx === -1) return [...prev, snapshot];
      const next = prev.slice();
      next[idx] = snapshot;
      return next;
    });
  }, []);

  /**
   * Long-poll a single run until it reaches a terminal status, the component
   * unmounts, or the poll is aborted. Re-arms itself after each snapshot while
   * the run is still active.
   */
  const pollRun = useCallback(
    async (checkRunId: string) => {
      if (pollingRef.current.has(checkRunId)) return;
      pollingRef.current.add(checkRunId);
      const controller = new AbortController();
      controllersRef.current.set(checkRunId, controller);
      const { signal } = controller;
      try {
        // Loop until terminal / unmount. awaitStatus long-polls server-side, so
        // this is not a busy loop; the inter-poll delay only guards a server
        // that answers immediately.
        for (;;) {
          if (!mountedRef.current || signal.aborted) return;
          const { data, problem } = await awaitStatus(checkRunId, WAIT_SECONDS);
          if (!mountedRef.current || signal.aborted) return;
          if (problem) {
            // A 404 means the run was deleted elsewhere; just stop polling it.
            return;
          }
          if (data) upsertRun(data);
          if (!data || !isActive(data.status)) return; // terminal → stop
          await delay(MIN_POLL_INTERVAL_MS, signal);
        }
      } finally {
        pollingRef.current.delete(checkRunId);
        controllersRef.current.delete(checkRunId);
      }
    },
    [upsertRun],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, problem } = await listChecks(sessionId);
    if (!mountedRef.current) return;
    setLoading(false);
    if (problem) {
      notifications.show({
        color: "red",
        title: `Could not load runs (${problem.status})`,
        message: problem.detail,
      });
      return;
    }
    setRuns(data ?? []);
  }, [sessionId]);

  useEffect(() => {
    mountedRef.current = true;
    // Initial load of the run list (refresh shows a spinner, then fetches) — a legitimate
    // load-on-mount effect, so set-state-in-effect is suppressed for this call.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load-on-mount with loading spinner
    void refresh();
    const controllers = controllersRef.current;
    const polling = pollingRef.current;
    return () => {
      mountedRef.current = false;
      controllers.forEach((c) => c.abort());
      controllers.clear();
      polling.clear();
    };
  }, [refresh]);

  // Whenever the run list changes, ensure every active run is being polled.
  useEffect(() => {
    if (!mountedRef.current) return;
    for (const run of runs) {
      if (run.checkRunId && isActive(run.status)) {
        void pollRun(run.checkRunId);
      }
    }
  }, [runs, pollRun]);

  // List-level discovery poll. Re-`listChecks` every 3s, but ONLY while no run
  // is active (PENDING/RUNNING): an active run already keeps the view live via
  // its per-run long-poll, so the list-poll stands down to avoid duplicate
  // fetches. This is what surfaces a brand-new run when the list is empty (or
  // all-terminal) without a manual Refresh. Torn down on unmount.
  useEffect(() => {
    const id = setInterval(() => {
      if (!mountedRef.current) return;
      // Skip this tick while any run is active — its long-poll owns liveness.
      if (runsRef.current.some((r) => isActive(r.status))) return;
      void refresh();
    }, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  const handleCancel = useCallback(async (checkRunId: string) => {
    const { problem } = await cancelCheck(checkRunId);
    if (!mountedRef.current) return;
    if (problem) {
      notifications.show({
        color: "red",
        title: `Could not cancel run (${problem.status})`,
        message: problem.detail,
      });
      return;
    }
    notifications.show({ color: "blue", title: "Cancellation requested", message: checkRunId });
  }, []);

  const handleDelete = useCallback(async (checkRunId: string) => {
    const { problem } = await deleteCheck(checkRunId);
    if (!mountedRef.current) return;
    if (problem) {
      const title =
        problem.status === 409
          ? "Run is still in flight"
          : `Could not delete run (${problem.status})`;
      notifications.show({ color: "red", title, message: problem.detail });
      return;
    }
    // Stop any poll for the removed run and drop it from the table.
    controllersRef.current.get(checkRunId)?.abort();
    controllersRef.current.delete(checkRunId);
    pollingRef.current.delete(checkRunId);
    setRuns((prev) => prev.filter((r) => r.checkRunId !== checkRunId));
    notifications.show({ color: "green", title: "Run deleted", message: checkRunId });
  }, []);

  // Newest-first, id-tiebroken — defensive render-time ordering (upsertRun appends, and live
  // snapshots can arrive out of order).
  const ordered = [...runs].sort((a, b) => {
    const t = (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    return t !== 0 ? t : (a.checkRunId ?? "").localeCompare(b.checkRunId ?? "");
  });

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={3}>Runs</Title>
        <Button variant="light" onClick={() => void refresh()}>
          Refresh
        </Button>
      </Group>

      {loading ? (
        <Group>
          <Loader size="sm" />
          <Text>Loading runs…</Text>
        </Group>
      ) : runs.length === 0 ? (
        <Text c="dimmed">No runs yet. Start a check from a session to see it here.</Text>
      ) : (
        <Table striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Run</Table.Th>
              <Table.Th>Session</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Rules</Table.Th>
              <Table.Th>Datasets</Table.Th>
              <Table.Th>Findings</Table.Th>
              <Table.Th>Created</Table.Th>
              <Table.Th>Finished</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {ordered.map((run) => {
              const id = run.checkRunId ?? "";
              const sid = run.sessionId ?? "";
              const sessionName = run.sessionName ?? "";
              const active = isActive(run.status);
              const succeeded = run.status === "SUCCEEDED";
              // Terminal runs open their results/log; active (PENDING/RUNNING) runs
              // open the same view to stream their live execution log.
              const openable =
                run.status !== undefined && (TERMINAL_STATES.has(run.status) || active);
              const openLabel = succeeded ? "View results" : active ? "Live log" : "View log";
              return (
                <Table.Tr key={id}>
                  <Table.Td>
                    <Text size="sm">{id}</Text>
                  </Table.Td>
                  <Table.Td>
                    {sessionName ? (
                      <Stack gap={0}>
                        <Text size="sm">{sessionName}</Text>
                        <Text size="xs" c="dimmed">
                          {sid}
                        </Text>
                      </Stack>
                    ) : (
                      <Text size="sm">{sid}</Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <StatusBadge status={run.status} />
                  </Table.Td>
                  <Table.Td>{run.rulesExecuted ?? 0}</Table.Td>
                  <Table.Td>
                    {run.processedDatasets ?? 0}/{run.totalDatasets ?? 0}
                  </Table.Td>
                  <Table.Td>{run.findingCount ?? 0}</Table.Td>
                  <Table.Td>{formatTimestamp(run.createdAt)}</Table.Td>
                  <Table.Td>{formatTimestamp(run.finishedAt)}</Table.Td>
                  <Table.Td>
                    <Group gap="xs" justify="flex-end">
                      {openable && run.status && (
                        <Button
                          variant="light"
                          size="xs"
                          onClick={() => onSelectRun?.(id, run.status as CheckRunStatusT)}
                        >
                          {openLabel}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={!active}
                        onClick={() => void handleCancel(id)}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="outline"
                        color="red"
                        size="xs"
                        onClick={() => void handleDelete(id)}
                      >
                        Delete
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}
