import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { renderWithProviders } from "../test/renderWithProviders";
import { ResultsView } from "./ResultsView";
import { server } from "../test/server";

describe("ResultsView", () => {
  beforeEach(() => {
    // jsdom lacks createObjectURL/revokeObjectURL used by the download helper.
    Object.defineProperty(URL, "createObjectURL", { value: () => "blob:x", writable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: () => {}, writable: true });
  });

  it("shows a not-terminal notice when the run has no usable status", () => {
    // No status prop and the status long-poll has not resolved yet → the
    // fallback notice (the live panel only renders for an observed-active run).
    renderWithProviders(<ResultsView checkRunId="run-1" />);
    expect(screen.getByText(/Results and the execution log/i)).toBeInTheDocument();
  });

  it("streams the live log while RUNNING, appending across polls with an advancing cursor", async () => {
    const seenFroms: number[] = [];
    server.use(
      // Keep the run RUNNING so the live panel stays mounted for the duration.
      http.get("*/api/checks/:id/status", () =>
        HttpResponse.json({ checkRunId: "run-1", status: "RUNNING" }),
      ),
      http.get("*/api/checks/:id/log/lines", ({ request }) => {
        const from = Number(new URL(request.url).searchParams.get("from") ?? "0");
        seenFroms.push(from);
        // First poll (from=0): two lines, cursor advances to 2, not terminal.
        // Later polls (from=2): one more line, cursor 3, still not terminal.
        if (from === 0) {
          return HttpResponse.json({
            lines: ["INFO first", "INFO second"],
            nextFrom: 2,
            terminal: false,
          });
        }
        return HttpResponse.json({ lines: ["DEBUG third"], nextFrom: 3, terminal: false });
      }),
    );
    renderWithProviders(<ResultsView checkRunId="run-1" status="RUNNING" />);
    // The live panel renders the streamed lines, appending across polls.
    expect(await screen.findByText(/INFO first/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(await screen.findByText(/DEBUG third/, {}, { timeout: 3000 })).toBeInTheDocument();
    // The cursor advanced: first poll from=0, a later poll from=2.
    await waitFor(() => expect(seenFroms).toContain(0));
    await waitFor(() => expect(seenFroms).toContain(2));
  });

  it("stops the live poll and swaps to the full overlay when the status poll reports terminal", async () => {
    let statusCalls = 0;
    server.use(
      http.get("*/api/checks/:id/status", () => {
        statusCalls += 1;
        // First status poll: still RUNNING. Second: SUCCEEDED (after persistence).
        return statusCalls === 1
          ? HttpResponse.json({ checkRunId: "run-1", status: "RUNNING" })
          : HttpResponse.json({ checkRunId: "run-1", status: "SUCCEEDED" });
      }),
      // The early /log/lines terminal flag flips before persistence — it must only
      // STOP the line poll, never trigger the full-log fetch.
      http.get("*/api/checks/:id/log/lines", () =>
        HttpResponse.json({ lines: ["INFO running"], nextFrom: 1, terminal: false }),
      ),
    );
    renderWithProviders(<ResultsView checkRunId="run-1" status="RUNNING" />);
    // Live panel first.
    expect(await screen.findByText(/INFO running/, {}, { timeout: 3000 })).toBeInTheDocument();
    // Once the status poll observes SUCCEEDED, the full results/overlay swap in:
    // the SUCCEEDED-only downloads + the structured log "View log" button appear.
    expect(await screen.findByText("Report (JSON)", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "View log" })).toBeInTheDocument();
  });

  it("retries the structured log fetch once on a 409 then renders it", async () => {
    let logCalls = 0;
    server.use(
      http.get("*/api/checks/:id/log", () => {
        logCalls += 1;
        // First fetch races the persistence and 409s; the retry succeeds.
        if (logCalls === 1) {
          return HttpResponse.json({ status: 409, detail: "No log yet" }, { status: 409 });
        }
        return HttpResponse.json({
          runId: "run-1",
          status: "FAILED",
          failureMessage: "kaboom",
          domains: [],
          files: [],
          logLines: [],
        });
      }),
    );
    renderWithProviders(<ResultsView checkRunId="run-1" status="FAILED" />);
    // The retried fetch eventually surfaces the failure message.
    expect(await screen.findByText("kaboom", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(logCalls).toBeGreaterThanOrEqual(2);
  });

  it("clears the result sources and shows the live panel when pointed at a RUNNING run", async () => {
    server.use(
      http.get("*/api/checks/:id/status", () =>
        HttpResponse.json({ checkRunId: "run-2", status: "RUNNING" }),
      ),
      http.get("*/api/checks/:id/log/lines", () =>
        HttpResponse.json({ lines: [], nextFrom: 0, terminal: false }),
      ),
    );
    const { rerender } = renderWithProviders(<ResultsView checkRunId="run-1" status="SUCCEEDED" />);
    expect(await screen.findByText("Report (JSON)")).toBeInTheDocument();
    // Pointing the view at a different, RUNNING run re-seeds the live status,
    // clears the SUCCEEDED-only sources during render, and shows the live panel.
    rerender(
      <MantineProvider>
        <Notifications />
        <ResultsView checkRunId="run-2" status="RUNNING" />
      </MantineProvider>,
    );
    expect(await screen.findByText("Live log")).toBeInTheDocument();
    expect(screen.queryByText("Report (JSON)")).not.toBeInTheDocument();
  });

  it("renders info (compressed) and downloads for a succeeded run", async () => {
    renderWithProviders(<ResultsView checkRunId="run-1" status="SUCCEEDED" />);
    expect(await screen.findByText("Report (JSON)")).toBeInTheDocument();
    expect(screen.getByText("Combined report (v2 JSON)")).toBeInTheDocument();
    expect(screen.getByText("Report (Excel)")).toBeInTheDocument();
    // The compressed Standard line folds standard + version.
    expect(await screen.findByText("SDTMIG V3.4")).toBeInTheDocument();
    // Computed Info totals.
    expect(screen.getByText("Number of Domains Checked")).toBeInTheDocument();
    expect(screen.getByText("Number of Findings")).toBeInTheDocument();
    // Dropped Issue-limit rows are gone.
    expect(screen.queryByText("Issue limit / rule")).not.toBeInTheDocument();
    expect(screen.queryByText("Issue limit / dataset")).not.toBeInTheDocument();
    // The Excel size now shows a formatted size (8192 bytes → 8.00 KiB).
    expect(screen.getByText("8.00 KiB")).toBeInTheDocument();
    // Timestamp formatting strips fractional seconds.
    expect(screen.getAllByText("2026-05-29T10:06:00Z").length).toBeGreaterThan(0);
  });

  /*
   * Plan 2 Phase 7 — the substandard restoration (owner ruling 2026-08-28).
   *
   * Plan 1 dropped `substandard` from the REST response while the *report* kept carrying
   * Sub_Standard, so web users saw no substandard line at all. It is DERIVED server-side (the
   * declared TIG leg) and DISPLAY-ONLY: it is folded into the Standard line and there is no
   * input control for it anywhere on the run form.
   *
   * ⚠ Review R-19: the pipeline emits the leg LOWERCASE — `CompanionSdtmDefaults.tigLeg`
   * returns the raw key segment ("adam") and the report's Sub_Standard passes through raw —
   * so the fixture pins the real wire value, not a prettified one. Whether the display should
   * read "(ADaM)" is an open presentation question for the owner.
   */
  it("folds a derived substandard into the Standard line", async () => {
    server.use(
      http.get("*/api/checks/:id/conformance", () =>
        HttpResponse.json({
          standard: "TIG",
          substandard: "adam",
          version: "V1.0",
          ctVersion: "2023-12-15",
          reportGeneration: "2026-05-28T10:00:09Z",
        }),
      ),
    );
    renderWithProviders(<ResultsView checkRunId="run-1" status="SUCCEEDED" />);
    expect(await screen.findByText("TIG V1.0 (adam)")).toBeInTheDocument();
  });

  /*
   * Phase 9 batch B3 — Dictionary_Basis reached the REST JSON but not the screen: the
   * hand-maintained INFO_FIELDS list was never extended, so the API said "degraded: 0 of 98
   * answerable" while the page showed a clean run (Fix #369's gap one layer further out — and
   * under D12 the degraded state is the DEFAULT for a fresh deployment). The basis lines render
   * as an alert ABOVE the metadata table, deliberately not as two more skimmable info rows.
   */
  it("surfaces the dictionary and library degradation bases as an alert", async () => {
    server.use(
      http.get("*/api/checks/:id/conformance", () =>
        HttpResponse.json({
          standard: "SDTMIG",
          version: "V3.4",
          reportGeneration: "2026-05-28T10:00:09Z",
          dictionaryBasis:
            "external dictionaries degraded: 0 of 98 dictionary rules in this run were answerable, the rest SKIPPED.",
          libraryMetadataBasis:
            "unavailable — the CDISC Library could not be consulted for this run; rules that cite it were SKIPPED",
        }),
      ),
    );
    renderWithProviders(<ResultsView checkRunId="run-1" status="SUCCEEDED" />);
    expect(
      await screen.findByText("Degraded run — some rules could not be answered"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Dictionary basis: external dictionaries degraded/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Library metadata basis: unavailable/)).toBeInTheDocument();
  });

  it("shows no degradation alert on a healthy run", async () => {
    // The default handler's conformance carries neither basis field.
    renderWithProviders(<ResultsView checkRunId="run-1" status="SUCCEEDED" />);
    expect(await screen.findByText("Report (JSON)")).toBeInTheDocument();
    expect(
      screen.queryByText("Degraded run — some rules could not be answered"),
    ).not.toBeInTheDocument();
  });

  it("renders the flat dataset drill-down with three rule groups (no tabs)", async () => {
    renderWithProviders(<ResultsView checkRunId="run-1" status="SUCCEEDED" />);
    expect(await screen.findByRole("heading", { name: "dm.xpt" })).toBeInTheDocument();
    expect(await screen.findByText("DM — Demographics")).toBeInTheDocument();
    // Group 1 (default expanded) headline — errors + finding-rules combined into one count.
    expect(
      await screen.findByText(/1 rules executed with 2 findings or ERRORs/),
    ).toBeInTheDocument();
    // Group 2 (skipped) headline.
    expect(screen.getByText(/1 rules skipped/)).toBeInTheDocument();
    // No tabs anymore.
    expect(screen.queryByRole("tab", { name: /datasets/i })).not.toBeInTheDocument();
    // Per-dataset runtime shows in the domain header (1500 ms → rolled up to seconds).
    expect(screen.getByText("Runtime: 1.50 s")).toBeInTheDocument();
    // The executed rule's per-rule runtime renders in its row (250 ms, sub-second).
    expect(await screen.findByRole("cell", { name: "250 ms" })).toBeInTheDocument();
  });

  it("opens the log overlay via the View log button", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResultsView checkRunId="run-1" status="SUCCEEDED" />);
    await user.click(await screen.findByRole("button", { name: "View log" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Configuration")).toBeInTheDocument();
    expect(within(dialog).getAllByText("DM").length).toBeGreaterThan(0);
    // The Domains summary table carries the per-dataset runtime column (1500 ms → 1.50 s).
    expect(within(dialog).getByRole("cell", { name: "1.50 s" })).toBeInTheDocument();
  });

  it("opens the rule-definition overlay with JSON / YAML tabs when a rule id is clicked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResultsView checkRunId="run-1" status="SUCCEEDED" />);
    await user.click(await screen.findByRole("button", { name: "CORE-000001" }));
    const dialog = await screen.findByRole("dialog");
    // The modal now switches between formats: JSON (default) and YAML tabs.
    expect(within(dialog).getByRole("tab", { name: "JSON" })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "YAML" })).toBeInTheDocument();
    // The default JSON tab hosts the interactive (lazy-loaded) JSON tree; wait
    // for its Copy-raw-JSON action to confirm the viewer mounted.
    expect(
      await within(dialog).findByRole("button", { name: "Copy raw JSON" }),
    ).toBeInTheDocument();
    // The `Core` object is expanded by default, so its `CORE-000001` leaf
    // renders as its own tree node (value), not a `"Id": "..."` string.
    expect(within(dialog).getAllByText(/CORE-000001/).length).toBeGreaterThan(0);
  });

  it("renders the YAML tab of the rule-definition overlay", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResultsView checkRunId="run-1" status="SUCCEEDED" />);
    await user.click(await screen.findByRole("button", { name: "CORE-000001" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("tab", { name: "YAML" }));
    // The lazy CodeMirror viewer mounts and exposes its Copy-raw-YAML action.
    expect(
      await within(dialog).findByRole("button", { name: "Copy raw YAML" }),
    ).toBeInTheDocument();
  });

  it("drills into a rule's findings with reordered columns", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResultsView checkRunId="run-1" status="SUCCEEDED" />);
    await screen.findByText("USUBJID must be present");
    // The violations cell is a button labelled "<n> ▸" (the count is a button).
    const trigger = screen.getAllByRole("button").find((b) => /\d\s*▸/.test(b.textContent ?? ""));
    expect(trigger).toBeDefined();
    await user.click(trigger as HTMLElement);
    // Findings come from the handler fixture (STUDY-001 / "USUBJID is required").
    expect(await screen.findByText("STUDY-001", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(await screen.findByText("STUDY-002")).toBeInTheDocument();
    // The findings sub-table no longer has an Executability column.
    expect(screen.queryByRole("columnheader", { name: "Executability" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "USUBJID" })).toBeInTheDocument();
    // A trailing Variables column shows the reported variable = value pairs
    // (fixture: variables ["USUBJID"], values [""] → "USUBJID = ").
    expect(screen.getByRole("columnheader", { name: "Variables" })).toBeInTheDocument();
    expect((await screen.findAllByText(/USUBJID =/)).length).toBeGreaterThan(0);
    // The per-row Message column is gone; the (constant) message is hoisted above the table once.
    expect(screen.queryByRole("columnheader", { name: "Message" })).not.toBeInTheDocument();
    expect(screen.getAllByText("USUBJID is required").length).toBeGreaterThan(0);
    // No fixture row carries an EC-40 record key (the default `corej.findingKeys=off`), so the
    // Key column is absent and the table is exactly what it was before EC-40.
    expect(screen.queryByRole("columnheader", { name: "Key" })).not.toBeInTheDocument();
  });

  it("shows a Key column with the record key when a finding carries one", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/checks/:id/findings", () =>
        HttpResponse.json({
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
              keyVariables: ["QNAM", "IDVARVAL"],
              keys: { QNAM: "AESOSP", IDVARVAL: "3" },
              // The tier is on the wire but deliberately not rendered (D10).
              keySource: "SPONSOR_ID",
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
              keyVariables: ["QNAM", "IDVARVAL"],
              keys: { QNAM: "AESOSP" },
            },
          ],
        }),
      ),
    );
    renderWithProviders(<ResultsView checkRunId="run-1" status="SUCCEEDED" />);
    await screen.findByText("USUBJID must be present");
    const trigger = screen.getAllByRole("button").find((b) => /\d\s*▸/.test(b.textContent ?? ""));
    await user.click(trigger as HTMLElement);

    expect(await screen.findByRole("columnheader", { name: "Key" })).toBeInTheDocument();
    expect(screen.getByText("QNAM = AESOSP, IDVARVAL = 3")).toBeInTheDocument();
    // A key column the row does not carry renders as an empty value, not as a dropped pair.
    expect(screen.getByText("QNAM = AESOSP, IDVARVAL =")).toBeInTheDocument();
    // The tier is never surfaced anywhere in the table (D10).
    expect(screen.queryByText(/SPONSOR_ID/)).not.toBeInTheDocument();
  });

  it("uses executability as the Note fallback when no notExecutedReason", async () => {
    renderWithProviders(<ResultsView checkRunId="run-1" status="SUCCEEDED" />);
    // CORE-000001 has no notExecutedReason but executability "Fully Executable";
    // it lives in the default-expanded group 1.
    await screen.findByText("USUBJID must be present");
    expect((await screen.findAllByText("Fully Executable")).length).toBeGreaterThan(0);
  });

  it("downloads the report as a blob", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResultsView checkRunId="run-1" status="SUCCEEDED" />);
    await user.click(await screen.findByText("Report (JSON)"));
    // No throw / notification means the download path resolved.
    expect(screen.getByText("Report (JSON)")).toBeInTheDocument();
  });

  it("downloads the v2 combined report as a blob", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResultsView checkRunId="run-1" status="SUCCEEDED" />);
    await user.click(await screen.findByText("Combined report (v2 JSON)"));
    // No throw / notification means the /report-v2 download path resolved.
    expect(screen.getByText("Combined report (v2 JSON)")).toBeInTheDocument();
  });

  it("shows the engine error message in the Note cell for an ERROR rule", async () => {
    server.use(
      http.get("*/api/checks/:id/dataset-groups", () =>
        HttpResponse.json([
          {
            fileName: "ae.xpt",
            sizeBytes: 1024,
            sha256: "deadbeef",
            modificationDate: "2026-05-28T09:00:00Z",
            domains: [
              {
                domain: "AE",
                label: "Adverse Events",
                rows: 10,
                columns: 5,
                rules: [
                  {
                    coreId: "CORE-000900",
                    generatedId: "uuid-err",
                    status: "ERROR",
                    violations: 0,
                    description: "AE rule that blew up",
                    executability: "Fully Executable",
                  },
                ],
              },
            ],
          },
        ]),
      ),
      http.get("*/api/checks/:id/log", () =>
        HttpResponse.json({
          runId: "run-1",
          status: "SUCCEEDED",
          domains: [
            {
              domain: "AE",
              fileName: "ae.xpt",
              rulesExecuted: 1,
              rulesTotal: 1,
              findings: 0,
              errors: [{ ruleId: "CORE-000900", message: "Operation timed out" }],
              ruleExecutions: [],
            },
          ],
          files: [],
          logLines: [],
        }),
      ),
    );
    renderWithProviders(<ResultsView checkRunId="run-1" status="SUCCEEDED" />);
    // The ERROR row's Note cell shows the joined error message, not the executability fallback.
    expect(await screen.findByText("Operation timed out")).toBeInTheDocument();
  });

  it("loads the execution log for a failed run and shows the failure alert", async () => {
    server.use(
      http.get("*/api/checks/:id/log", () =>
        HttpResponse.json({
          runId: "run-1",
          status: "FAILED",
          failureMessage: "boom",
          domains: [],
          files: [],
          logLines: [],
        }),
      ),
    );
    renderWithProviders(<ResultsView checkRunId="run-1" status="FAILED" />);
    // The failure alert is shown inline for non-succeeded runs.
    expect(await screen.findByText("boom")).toBeInTheDocument();
    // The View-log overlay is still available for failed runs.
    expect(screen.getByRole("button", { name: "View log" })).toBeInTheDocument();
  });
});
