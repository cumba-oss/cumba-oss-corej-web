import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import userEvent from "@testing-library/user-event";
import { cleanNotifications } from "@mantine/notifications";
import { screen, waitFor } from "@testing-library/react";
import { server } from "../test/server";
import { renderWithProviders } from "../test/renderWithProviders";
import type { CheckRunRequestT } from "../api/types";
import { NewRunView } from "./NewRunView";

// jsdom lacks ResizeObserver, which Mantine's Select/MultiSelect (ScrollArea)
// touch on mount, and Element.scrollIntoView, which Mantine's Combobox calls
// when highlighting an option. Provide inert stubs for this suite so the
// dropdown interaction doesn't throw under jsdom.
beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    globalThis.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = (): void => {};
  }
});

// Clear the global notification store between tests so a fresh toast renders
// immediately rather than queuing behind earlier tests' toasts.
afterEach(() => cleanNotifications());

describe("NewRunView", () => {
  it("shows inline validation errors for the required fields", async () => {
    const user = userEvent.setup();
    let posted = false;
    server.use(
      http.post("/api/sessions/:id/checks", () => {
        posted = true;
        return HttpResponse.json({ checkRunId: "c-1" }, { status: 201 });
      }),
    );

    const { getByRole, findByText } = renderWithProviders(
      <NewRunView sessionId="s-1" availableFiles={[]} />,
    );

    await user.click(getByRole("button", { name: /start check/i }));

    expect(
      await findByText("Select at least one rules package (or upload rule files)"),
    ).toBeInTheDocument();
    expect(posted).toBe(false);
  });

  it("maps the form to a minimal CheckRunRequest body and reports the run id", async () => {
    const user = userEvent.setup();
    const onStarted = vi.fn();
    let body: CheckRunRequestT | undefined;
    server.use(
      http.post("/api/sessions/:id/checks", async ({ request }) => {
        body = (await request.json()) as CheckRunRequestT;
        return HttpResponse.json({ checkRunId: "c-99" }, { status: 201 });
      }),
    );

    const { getByRole } = renderWithProviders(
      <NewRunView sessionId="s-1" availableFiles={[]} onStarted={onStarted} />,
    );

    // With no run-options metadata the package picker is a free-text TagsInput.
    await user.type(getByRole("combobox", { name: /Rules packages/ }), "cdisc-sdtmig-3-4{enter}");

    await user.click(getByRole("button", { name: /start check/i }));

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("c-99"));
    // Only the two required fields; no empty optionals and no rule-selection mode.
    expect(body).toEqual({ rulesPackages: ["cdisc-sdtmig-3-4"] });
  });

  it("includes only non-empty optional fields, trimmed", async () => {
    const user = userEvent.setup();
    let body: CheckRunRequestT | undefined;
    server.use(
      http.post("/api/sessions/:id/checks", async ({ request }) => {
        body = (await request.json()) as CheckRunRequestT;
        return HttpResponse.json({ checkRunId: "c-1" }, { status: 201 });
      }),
    );

    const { getByLabelText, getByRole } = renderWithProviders(
      <NewRunView sessionId="s-1" availableFiles={[]} />,
    );

    await user.type(getByRole("combobox", { name: /Rules packages/ }), "cdisc-sdtmig-3-4{enter}");
    await user.type(getByLabelText("Rule threads"), "4");

    await user.click(getByRole("button", { name: /start check/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toEqual({
      rulesPackages: ["cdisc-sdtmig-3-4"],
      ruleThreads: 4,
    });
  });

  it("sends includeRules without a rule-selection mode when rules are selected", async () => {
    const user = userEvent.setup();
    let body: CheckRunRequestT | undefined;
    server.use(
      http.post("/api/sessions/:id/checks", async ({ request }) => {
        body = (await request.json()) as CheckRunRequestT;
        return HttpResponse.json({ checkRunId: "c-2" }, { status: 201 });
      }),
    );

    const { getByRole } = renderWithProviders(<NewRunView sessionId="s-1" availableFiles={[]} />);

    // With no run-options metadata the package picker is a free-text TagsInput.
    await user.type(getByRole("combobox", { name: /Rules packages/ }), "cdisc-sdtmig-3-4{enter}");
    // With no rule metadata the include picker is a free-text TagsInput.
    await user.type(getByRole("combobox", { name: "Include rules" }), "CORE-000001{enter}");

    await user.click(getByRole("button", { name: /start check/i }));

    await waitFor(() => expect(body).toBeDefined());
    // The narrowing is derived from includeRules alone — no ruleSelectionMode field.
    expect(body).toEqual({
      rulesPackages: ["cdisc-sdtmig-3-4"],
      includeRules: ["CORE-000001"],
    });
  });

  it("surfaces a server error as a notification and does not call onStarted", async () => {
    const user = userEvent.setup();
    const onStarted = vi.fn();
    server.use(
      http.post("/api/sessions/:id/checks", () =>
        HttpResponse.json({ status: 400, detail: "Unknown standard" }, { status: 400 }),
      ),
    );

    const { getByRole } = renderWithProviders(
      <NewRunView sessionId="s-1" availableFiles={[]} onStarted={onStarted} />,
    );

    await user.type(getByRole("combobox", { name: /Rules packages/ }), "bogus{enter}");
    await user.click(getByRole("button", { name: /start check/i }));

    expect(await screen.findByText("Unknown standard", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("offers uploaded files as a select when availableFiles is non-empty", async () => {
    const { getByRole } = renderWithProviders(
      <NewRunView sessionId="s-1" availableFiles={["dm.xpt", "ae.xpt"]} />,
    );
    // With files present, the define.xml picker is a readonly Select input
    // (not a free-text TextInput).
    const define = getByRole("combobox", { name: "Define.xml file" });
    expect(define).toHaveAttribute("readonly");
  });

  it("renders the non-free-text run-option fields as dropdowns when metadata is present", async () => {
    server.use(
      http.get("/api/meta/run-options", () =>
        HttpResponse.json({
          packages: [
            { name: "cdisc-sdtmig-3-4", standards: ["sdtmig/3-4"] },
            { name: "cdisc-adamig-1-3", standards: ["adam/adamig-1-3"] },
          ],
          defineVersions: ["2.1.0", "2.0.0"],
        }),
      ),
      http.get("/api/meta/rules", () =>
        HttpResponse.json({
          rules: [
            { id: "CORE-1", description: "first rule" },
            { id: "CORE-2", description: "second rule" },
          ],
          useCases: ["INDH"],
        }),
      ),
    );
    const { findByRole, getByRole } = renderWithProviders(
      <NewRunView sessionId="s-1" availableFiles={["dm.xpt"]} />,
    );

    // Once run-options load, Define version becomes a (readonly) Select input
    // rather than a free-text TextInput.
    await waitFor(() =>
      expect(getByRole("combobox", { name: "Define version" })).toHaveAttribute("readonly"),
    );
    // The rules-package picker is a searchable MultiSelect sourced from the metadata: opening it
    // must offer the packages /run-options returned. Asserting only that the control exists would
    // pass just as well against the free-text fallback, i.e. prove nothing about the metadata.
    const picker = await findByRole("combobox", { name: /Rules packages/ });
    await userEvent.setup().click(picker);
    expect(await findByRole("option", { name: "cdisc-sdtmig-3-4" })).toBeInTheDocument();
  });

  it("auto-defaults define.xml and rules-*.json from the uploaded files", async () => {
    const user = userEvent.setup();
    let body: CheckRunRequestT | undefined;
    server.use(
      http.post("/api/sessions/:id/checks", async ({ request }) => {
        body = (await request.json()) as CheckRunRequestT;
        return HttpResponse.json({ checkRunId: "c-1" }, { status: 201 });
      }),
    );

    const { getByRole } = renderWithProviders(
      <NewRunView
        sessionId="s-1"
        availableFiles={["define.xml", "rules-sdtmig-3-4.json", "rules-extra.json", "dm.xpt"]}
      />,
    );
    // With no run-options metadata the package picker is a free-text TagsInput.
    await user.type(getByRole("combobox", { name: /Rules packages/ }), "cdisc-sdtmig-3-4{enter}");
    await user.click(getByRole("button", { name: /start check/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body?.defineXmlFilename).toBe("define.xml");
    expect(body?.rulesFilenames).toEqual(["rules-sdtmig-3-4.json", "rules-extra.json"]);
  });

  // V4 (review R-7): a run whose rules come only from uploaded rules files has no package to
  // declare its CDISC Library standard, so it is certain to fail server-side without metadata
  // products. The validator used to pass this shape — and rulesFilenames is AUTO-FILLED from
  // any uploaded rules-*.json, so a user reached it without choosing it — queueing a run that
  // failed asynchronously. The form must block it with an error naming the field that fixes
  // it, and naming a product must unblock the submit.
  it("requires metadata products when rules come only from uploaded rules files (V4)", async () => {
    const user = userEvent.setup();
    let body: CheckRunRequestT | undefined;
    server.use(
      http.post("/api/sessions/:id/checks", async ({ request }) => {
        body = (await request.json()) as CheckRunRequestT;
        return HttpResponse.json({ checkRunId: "c-1" }, { status: 201 });
      }),
    );

    const { getByRole, findByText } = renderWithProviders(
      <NewRunView sessionId="s-1" availableFiles={["rules-extra.json", "dm.xpt"]} />,
    );

    // rulesFilenames auto-fills from the uploaded rules-*.json; the user selects nothing.
    await user.click(getByRole("button", { name: /start check/i }));
    expect(
      await findByText(/Metadata products are required when rules come only from uploaded/),
    ).toBeInTheDocument();
    expect(body).toBeUndefined();

    // Naming a product satisfies the guard and the run submits with both fields.
    await user.type(getByRole("combobox", { name: /Metadata products/ }), "sdtmig/3-4{enter}");
    await user.click(getByRole("button", { name: /start check/i }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body?.rulesFilenames).toEqual(["rules-extra.json"]);
    expect(body?.metadataProducts).toEqual(["sdtmig/3-4"]);
    // No package was selected — this really is the file-only shape.
    expect(body?.rulesPackages).toEqual([]);
  });

  // Fix #217: the "Reference data files" control was DELETED. Naming a file in
  // referenceDataFilenames resolves it inside the one flat session directory and opens
  // it as a *library*, which makes it a validation target and hard-fails the run for
  // Dataset-JSON / CSV / Parquet. The dataset filter already expresses reference-data
  // semantics: an unlisted member becomes a reference dataset. The REST field stays on
  // the published surface; this client must simply never drive it.
  it("no longer renders a reference-data control", () => {
    const { queryByRole, getByRole } = renderWithProviders(
      <NewRunView sessionId="s-1" availableFiles={["dm.xpt", "ae.xpt"]} />,
    );
    expect(queryByRole("textbox", { name: /reference data/i })).toBeNull();
    expect(queryByRole("combobox", { name: /reference data/i })).toBeNull();
    // The dataset filter is what replaces it, and it says so.
    expect(getByRole("combobox", { name: "Dataset filter" })).toBeInTheDocument();
    expect(
      screen.getByText("Members not listed here are loaded as reference data only"),
    ).toBeInTheDocument();
  });

  it("never sends referenceDataFilenames, even with uploaded files present", async () => {
    const user = userEvent.setup();
    let body: (CheckRunRequestT & Record<string, unknown>) | undefined;
    server.use(
      http.post("/api/sessions/:id/checks", async ({ request }) => {
        body = (await request.json()) as CheckRunRequestT & Record<string, unknown>;
        return HttpResponse.json({ checkRunId: "c-217" }, { status: 201 });
      }),
    );

    const { getByRole } = renderWithProviders(
      <NewRunView sessionId="s-1" availableFiles={["dm.xpt", "ae.xpt"]} />,
    );
    // With no run-options metadata the package picker is a free-text TagsInput.
    await user.type(getByRole("combobox", { name: /Rules packages/ }), "cdisc-sdtmig-3-4{enter}");
    await user.click(getByRole("button", { name: /start check/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).not.toHaveProperty("referenceDataFilenames");
  });

  it("shows the default include/exclude rule count labels", async () => {
    const { findByText } = renderWithProviders(<NewRunView sessionId="s-1" availableFiles={[]} />);
    // With nothing selected: include → All, exclude → None.
    expect(await findByText("All rules selected")).toBeInTheDocument();
    expect(await findByText("No rules selected")).toBeInTheDocument();
  });

  it("auto-detects and sets the define version when a define.xml is selected", async () => {
    renderWithProviders(<NewRunView sessionId="s-1" availableFiles={["define.xml"]} />);
    // availableFiles contains "define.xml" -> auto-selected -> version detected.
    expect(await screen.findByText(/Detected Define-XML version 2\.1/)).toBeInTheDocument();
    expect(screen.getByLabelText("Define version")).toHaveValue("2.1.0");
  });

  // ---- R4: the ordered metadata-product widget ------------------------------------------
  //
  // The field is OPTIONAL and ORDER IS PRECEDENCE. Both halves are load-bearing and neither is
  // provable from "the control renders": an omitted field must stay omitted from the request
  // body (empty and absent are equivalent downstream — effectiveMetadataProducts unions the
  // packages' declared standards either way — so this pins the minimal-body wire contract,
  // not a semantic difference), and the submitted order must be the user's pick order, not a
  // sorted one.

  it("omits metadataProducts entirely when none is chosen (R4 — the field is optional)", async () => {
    const user = userEvent.setup();
    let body: CheckRunRequestT | undefined;
    server.use(
      http.post("/api/sessions/:id/checks", async ({ request }) => {
        body = (await request.json()) as CheckRunRequestT;
        return HttpResponse.json({ checkRunId: "c-1" }, { status: 201 });
      }),
    );

    const { getByRole } = renderWithProviders(<NewRunView sessionId="s-1" availableFiles={[]} />);
    await user.type(getByRole("combobox", { name: /Rules packages/ }), "cdisc-sdtmig-3-4{enter}");
    await user.click(getByRole("button", { name: /start check/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).not.toHaveProperty("metadataProducts");
  });

  it("offers the catalogue's products and submits them in PICK order, not sorted", async () => {
    const user = userEvent.setup();
    let body: CheckRunRequestT | undefined;
    server.use(
      http.get("/api/meta/run-options", () =>
        HttpResponse.json({
          packages: [{ name: "cdisc-adamig-1-3", standards: ["adam/adamig-1-3"] }],
          defineVersions: ["2.1.0"],
          // Deliberately alphabetical, so a control that sorted its value would still
          // produce this order — the picks below invert it.
          metadataProducts: ["adam/adamig-1-3", "sdtmig/3-4"],
        }),
      ),
      http.post("/api/sessions/:id/checks", async ({ request }) => {
        body = (await request.json()) as CheckRunRequestT;
        return HttpResponse.json({ checkRunId: "c-1" }, { status: 201 });
      }),
    );

    const { findByRole, getByRole } = renderWithProviders(
      <NewRunView sessionId="s-1" availableFiles={[]} />,
    );

    // ⚠ The TagsInput fallback carries the SAME accessible name, so querying immediately
    // resolves it before /run-options lands and the click opens nothing. Wait for the
    // metadata-sourced MultiSelect, which is the only one with the select placeholder.
    await waitFor(() =>
      expect(getByRole("combobox", { name: /Metadata products/ })).toHaveAttribute(
        "placeholder",
        "Select (optional) — highest precedence first",
      ),
    );
    const products = getByRole("combobox", { name: /Metadata products/ });
    await user.click(products);
    await user.click(await findByRole("option", { name: "sdtmig/3-4" }));
    await user.click(await findByRole("option", { name: "adam/adamig-1-3" }));

    const packages = await findByRole("combobox", { name: /Rules packages/ });
    await user.click(packages);
    await user.click(await findByRole("option", { name: "cdisc-adamig-1-3" }));

    await user.click(getByRole("button", { name: /start check/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body?.metadataProducts).toEqual(["sdtmig/3-4", "adam/adamig-1-3"]);
  });

  it("reorders the chosen products, and the new order is what is submitted", async () => {
    const user = userEvent.setup();
    let body: CheckRunRequestT | undefined;
    server.use(
      http.post("/api/sessions/:id/checks", async ({ request }) => {
        body = (await request.json()) as CheckRunRequestT;
        return HttpResponse.json({ checkRunId: "c-1" }, { status: 201 });
      }),
    );

    const { getByRole, findByRole } = renderWithProviders(
      <NewRunView sessionId="s-1" availableFiles={[]} />,
    );
    // No run-options metadata -> the free-text TagsInput fallback, which is exactly the
    // offline case the reorder controls still have to work in.
    const products = getByRole("combobox", { name: /Metadata products/ });
    await user.type(products, "adam/adamig-1-3{enter}");
    await user.type(products, "sdtmig/3-4{enter}");

    // The second entry moves to the front; the first must fall to second.
    await user.click(await findByRole("button", { name: "Move sdtmig/3-4 earlier" }));

    await user.type(getByRole("combobox", { name: /Rules packages/ }), "cdisc-adamig-1-3{enter}");
    await user.click(getByRole("button", { name: /start check/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body?.metadataProducts).toEqual(["sdtmig/3-4", "adam/adamig-1-3"]);
  });

  it("disables the reorder control at each end of the list", async () => {
    const user = userEvent.setup();
    const { getByRole, findByRole } = renderWithProviders(
      <NewRunView sessionId="s-1" availableFiles={[]} />,
    );
    const products = getByRole("combobox", { name: /Metadata products/ });
    await user.type(products, "adam/adamig-1-3{enter}");
    await user.type(products, "sdtmig/3-4{enter}");

    expect(await findByRole("button", { name: "Move adam/adamig-1-3 earlier" })).toBeDisabled();
    expect(await findByRole("button", { name: "Move sdtmig/3-4 later" })).toBeDisabled();
    expect(await findByRole("button", { name: "Move adam/adamig-1-3 later" })).toBeEnabled();
  });

  it("notifies and leaves the define version empty when it can't be determined", async () => {
    server.use(
      http.get("/api/sessions/:id/files/:filename/define-version", () =>
        HttpResponse.json({ version: null, defineVersion: null }),
      ),
    );
    renderWithProviders(<NewRunView sessionId="s-1" availableFiles={["define.xml"]} />);
    expect(
      await screen.findByText(/Could not determine the Define-XML version/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Define version")).toHaveValue("");
  });
});
