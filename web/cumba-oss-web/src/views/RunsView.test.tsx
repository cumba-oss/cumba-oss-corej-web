import { afterEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import userEvent from "@testing-library/user-event";
import { cleanNotifications } from "@mantine/notifications";
import { screen, waitFor } from "@testing-library/react";
import { server } from "../test/server";
import { renderWithProviders } from "../test/renderWithProviders";
import type { CheckStatusT } from "../api/types";
import { RunsView } from "./RunsView";

function run(overrides: Partial<CheckStatusT> = {}): CheckStatusT {
  return {
    checkRunId: "c-1",
    sessionId: "s-1",
    status: "SUCCEEDED",
    totalDatasets: 3,
    processedDatasets: 3,
    rulesExecuted: 120,
    findingCount: 7,
    createdAt: "2026-05-28T10:00:00Z",
    finishedAt: "2026-05-28T10:00:09Z",
    ...overrides,
  };
}

afterEach(() => cleanNotifications());

describe("RunsView", () => {
  it("lists runs with their status and counts", async () => {
    server.use(http.get("/api/checks", () => HttpResponse.json([run()])));
    const { findByText } = renderWithProviders(<RunsView />);
    expect(await findByText("c-1")).toBeInTheDocument();
    expect(await findByText("SUCCEEDED")).toBeInTheDocument();
    expect(await findByText("3/3")).toBeInTheDocument();
  });

  it("shows an empty-state when there are no runs", async () => {
    server.use(http.get("/api/checks", () => HttpResponse.json([])));
    const { findByText } = renderWithProviders(<RunsView />);
    expect(await findByText(/No runs yet/i)).toBeInTheDocument();
  });

  it("scopes the list by sessionId", async () => {
    let seen: string | null = null;
    server.use(
      http.get("/api/checks", ({ request }) => {
        seen = new URL(request.url).searchParams.get("sessionId");
        return HttpResponse.json([run()]);
      }),
    );
    const { findByText } = renderWithProviders(<RunsView sessionId="s-9" />);
    await findByText("c-1");
    expect(seen).toBe("s-9");
  });

  it("surfaces a list error as a notification", async () => {
    server.use(
      http.get("/api/checks", () =>
        HttpResponse.json({ status: 500, detail: "boom" }, { status: 500 }),
      ),
    );
    renderWithProviders(<RunsView />);
    expect(await screen.findByText("boom", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("polls a RUNNING run until it reaches a terminal status and then stops", async () => {
    let listCalls = 0;
    let statusCalls = 0;
    server.use(
      http.get("/api/checks", () => {
        listCalls += 1;
        return HttpResponse.json([run({ status: "RUNNING", processedDatasets: 1 })]);
      }),
      http.get("/api/checks/:id/status", () => {
        statusCalls += 1;
        // First poll: still running. Second poll: succeeded (terminal).
        return statusCalls === 1
          ? HttpResponse.json(run({ status: "RUNNING", processedDatasets: 2 }))
          : HttpResponse.json(run({ status: "SUCCEEDED", processedDatasets: 3 }));
      }),
    );

    const { findByText } = renderWithProviders(<RunsView />);
    // Initial render shows RUNNING.
    expect(await findByText("RUNNING")).toBeInTheDocument();
    // Poll drives it to SUCCEEDED (allow for the inter-poll delay).
    expect(await findByText("SUCCEEDED", {}, { timeout: 4000 })).toBeInTheDocument();

    // Polling stopped at the terminal status: no further status calls arrive.
    await waitFor(() => expect(statusCalls).toBeGreaterThanOrEqual(2));
    const settled = statusCalls;
    await new Promise((r) => setTimeout(r, 1500));
    expect(statusCalls).toBe(settled);
    expect(listCalls).toBe(1);
  });

  it("aborts polling on unmount without a setState-after-unmount warning", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    let statusCalls = 0;
    server.use(
      http.get("/api/checks", () => HttpResponse.json([run({ status: "RUNNING" })])),
      http.get("/api/checks/:id/status", async () => {
        statusCalls += 1;
        // Hold the long-poll open so it is still in flight at unmount time.
        await new Promise((r) => setTimeout(r, 100));
        return HttpResponse.json(run({ status: "RUNNING" }));
      }),
    );

    const { findByText, unmount } = renderWithProviders(<RunsView />);
    await findByText("RUNNING");
    await waitFor(() => expect(statusCalls).toBeGreaterThanOrEqual(1));
    unmount();
    // Let the in-flight poll resolve after unmount; no setState should fire.
    await new Promise((r) => setTimeout(r, 200));
    const reactWarnings = warn.mock.calls.filter((c) =>
      String(c[0]).includes("unmounted component"),
    );
    expect(reactWarnings).toHaveLength(0);
    warn.mockRestore();
  });

  it("cancels a run", async () => {
    let cancelled = false;
    server.use(
      http.get("/api/checks", () => HttpResponse.json([run({ status: "RUNNING" })])),
      http.get("/api/checks/:id/status", () => HttpResponse.json(run({ status: "RUNNING" }))),
      http.post("/api/checks/:id/cancel", () => {
        cancelled = true;
        return new HttpResponse(null, { status: 202 });
      }),
    );
    const user = userEvent.setup();
    const { findByText, getByRole } = renderWithProviders(<RunsView />);
    await findByText("c-1");
    await user.click(getByRole("button", { name: /^cancel$/i }));
    await waitFor(() => expect(cancelled).toBe(true));
    expect(
      await screen.findByText("Cancellation requested", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  it("surfaces a cancel error", async () => {
    server.use(
      http.get("/api/checks", () => HttpResponse.json([run({ status: "RUNNING" })])),
      http.get("/api/checks/:id/status", () => HttpResponse.json(run({ status: "RUNNING" }))),
      http.post("/api/checks/:id/cancel", () =>
        HttpResponse.json({ status: 404, detail: "Unknown run" }, { status: 404 }),
      ),
    );
    const user = userEvent.setup();
    const { findByText, getByRole } = renderWithProviders(<RunsView />);
    await findByText("c-1");
    await user.click(getByRole("button", { name: /^cancel$/i }));
    expect(await screen.findByText("Unknown run", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("deletes a run and removes it from the table", async () => {
    server.use(
      http.get("/api/checks", () => HttpResponse.json([run()])),
      http.delete("/api/checks/:id", () => new HttpResponse(null, { status: 204 })),
    );
    const user = userEvent.setup();
    const { findByText, getByRole, queryByRole } = renderWithProviders(<RunsView />);
    await findByText("c-1");
    await user.click(getByRole("button", { name: /^delete$/i }));
    // The empty-state replaces the table once the only run is removed (the id
    // may still linger in the success toast, so assert on the table itself).
    await waitFor(() => expect(queryByRole("table")).not.toBeInTheDocument());
    expect(await findByText(/No runs yet/i)).toBeInTheDocument();
  });

  it("surfaces a 409 in-flight delete and keeps the run listed", async () => {
    server.use(
      http.get("/api/checks", () => HttpResponse.json([run()])),
      http.delete("/api/checks/:id", () =>
        HttpResponse.json({ status: 409, detail: "Cancel it first" }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    const { findByText, getByRole } = renderWithProviders(<RunsView />);
    await findByText("c-1");
    await user.click(getByRole("button", { name: /^delete$/i }));
    expect(
      await screen.findByText("Run is still in flight", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(await findByText("c-1")).toBeInTheDocument();
  });

  it("discovers a newly-appeared run via the list-poll while the list is empty", async () => {
    // shouldAdvanceTime lets real async (MSW fetch, testing-library waits) keep
    // progressing while we still control the 3s setInterval via advanceTimers.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let listCalls = 0;
      server.use(
        http.get("/api/checks", () => {
          listCalls += 1;
          // First fetch: empty. Subsequent fetches: a fresh PENDING run appears.
          return listCalls === 1
            ? HttpResponse.json([])
            : HttpResponse.json([run({ status: "PENDING" })]);
        }),
        http.get("/api/checks/:id/status", () => HttpResponse.json(run({ status: "PENDING" }))),
      );

      const { findByText, queryByText } = renderWithProviders(<RunsView />);
      // The initial mount fetch resolves to the empty state.
      expect(await findByText(/No runs yet/i)).toBeInTheDocument();
      expect(listCalls).toBe(1);
      expect(queryByText("c-1")).not.toBeInTheDocument();

      // Advance past the 3s list-poll interval: it re-fetches and surfaces c-1.
      await vi.advanceTimersByTimeAsync(3100);
      await waitFor(() => expect(listCalls).toBeGreaterThanOrEqual(2));
      expect(await findByText("c-1")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the list-poll interval on unmount (no further fetches)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let listCalls = 0;
      server.use(
        http.get("/api/checks", () => {
          listCalls += 1;
          return HttpResponse.json([]);
        }),
      );

      const { findByText, unmount } = renderWithProviders(<RunsView />);
      expect(await findByText(/No runs yet/i)).toBeInTheDocument();
      expect(listCalls).toBe(1);

      // One tick fires the list-poll while still mounted.
      await vi.advanceTimersByTimeAsync(3100);
      await waitFor(() => expect(listCalls).toBeGreaterThanOrEqual(2));
      const afterOneTick = listCalls;

      // After unmount no further ticks should fetch.
      unmount();
      await vi.advanceTimersByTimeAsync(9000);
      expect(listCalls).toBe(afterOneTick);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the session name with the id, and the bare id when unnamed", async () => {
    server.use(
      http.get("/api/checks", () =>
        HttpResponse.json([
          run({ checkRunId: "c-named", sessionId: "s-1", sessionName: "My study" }),
          run({
            checkRunId: "c-bare",
            sessionId: "s-2",
            sessionName: undefined,
            createdAt: "2026-05-27T10:00:00Z",
          }),
        ]),
      ),
    );
    const { findByText } = renderWithProviders(<RunsView />);
    // Named run: name shown with its id beneath; unnamed run: bare id.
    expect(await findByText("My study")).toBeInTheDocument();
    expect(await findByText("s-1")).toBeInTheDocument();
    expect(await findByText("s-2")).toBeInTheDocument();
  });

  it("renders runs newest-first regardless of server order", async () => {
    server.use(
      http.get("/api/checks", () =>
        HttpResponse.json([
          run({ checkRunId: "c-old", createdAt: "2026-01-01T00:00:00Z" }),
          run({ checkRunId: "c-new", createdAt: "2026-06-01T00:00:00Z" }),
        ]),
      ),
    );
    renderWithProviders(<RunsView />);
    await screen.findByText("c-old");
    const ids = screen.getAllByText(/^c-(old|new)$/);
    expect(ids[0]).toHaveTextContent("c-new");
    expect(ids[1]).toHaveTextContent("c-old");
  });

  it("exposes results selection only for a SUCCEEDED run", async () => {
    const selected: string[] = [];
    server.use(http.get("/api/checks", () => HttpResponse.json([run({ status: "SUCCEEDED" })])));
    const user = userEvent.setup();
    const { findByText, getByRole } = renderWithProviders(
      <RunsView onSelectRun={(id) => selected.push(id)} />,
    );
    await findByText("c-1");
    await user.click(getByRole("button", { name: /view results/i }));
    expect(selected).toEqual(["c-1"]);
  });

  it("exposes a Live-log open button for a RUNNING run", async () => {
    const selected: Array<[string, string]> = [];
    server.use(
      http.get("/api/checks", () => HttpResponse.json([run({ status: "RUNNING" })])),
      http.get("/api/checks/:id/status", () => HttpResponse.json(run({ status: "RUNNING" }))),
    );
    const user = userEvent.setup();
    const { findByText, getByRole } = renderWithProviders(
      <RunsView onSelectRun={(id, status) => selected.push([id, status])} />,
    );
    await findByText("c-1");
    // A RUNNING row is now openable with a "Live log" button.
    await user.click(getByRole("button", { name: /live log/i }));
    expect(selected).toEqual([["c-1", "RUNNING"]]);
  });
});
