import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import userEvent from "@testing-library/user-event";
import { cleanNotifications } from "@mantine/notifications";
import { screen, waitFor } from "@testing-library/react";
import { server } from "../test/server";
import { renderWithProviders } from "../test/renderWithProviders";
import type { FileUploadResponseT, SessionFileT, SessionSummaryT } from "../api/types";
import { SessionsView } from "./SessionsView";

// jsdom lacks ResizeObserver, which Mantine's Select/MultiSelect (rendered by
// the embedded NewRunView) touch on mount. Provide an inert stub for the suite.
beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    globalThis.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
});

const session: SessionSummaryT = {
  sessionId: "s-1",
  createdAt: "2026-05-28T10:00:00Z",
  fileCount: 0,
};

/** Grab the hidden react-dropzone <input type="file"> for a session card. */
function dropzoneInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("dropzone input not found");
  return input;
}

// Notifications use a global store with a visible limit; clear it between
// tests so a fresh toast renders immediately instead of being queued behind
// toasts left over from earlier tests.
afterEach(() => cleanNotifications());

describe("SessionsView", () => {
  it("lists sessions with their file count", async () => {
    server.use(http.get("/api/sessions", () => HttpResponse.json([{ ...session, fileCount: 3 }])));
    const { findByText } = renderWithProviders(<SessionsView />);
    expect(await findByText("s-1")).toBeInTheDocument();
    expect(await findByText(/3\s*file\(s\)/)).toBeInTheDocument();
  });

  it("shows an empty-state when there are no sessions", async () => {
    server.use(http.get("/api/sessions", () => HttpResponse.json([])));
    const { findByText } = renderWithProviders(<SessionsView />);
    expect(await findByText(/No sessions yet/i)).toBeInTheDocument();
  });

  it("creates a session via the modal and refreshes the list", async () => {
    let created = false;
    server.use(
      http.post("/api/sessions", () => {
        created = true;
        return HttpResponse.json({ sessionId: "s-2" });
      }),
      http.get("/api/sessions", () =>
        HttpResponse.json(created ? [session, { ...session, sessionId: "s-2" }] : [session]),
      ),
    );
    const user = userEvent.setup();
    const { findByText, getByRole } = renderWithProviders(<SessionsView />);
    await findByText("s-1");
    // "New session" opens a dialog; submit it with Create.
    await user.click(getByRole("button", { name: /new session/i }));
    await user.click(await screen.findByRole("button", { name: /^create$/i }));
    // "s-2" appears in the toast message and the new card; assert at least one.
    expect((await screen.findAllByText("s-2")).length).toBeGreaterThan(0);
  });

  it("creates a named session, sending the trimmed name in the body", async () => {
    let body: unknown = null;
    server.use(
      http.post("/api/sessions", async ({ request }) => {
        const text = await request.text();
        body = text ? JSON.parse(text) : null;
        return HttpResponse.json({ sessionId: "s-2", name: "Typed name" });
      }),
      http.get("/api/sessions", () => HttpResponse.json([session])),
    );
    const user = userEvent.setup();
    const { findByText, getByRole } = renderWithProviders(<SessionsView />);
    await findByText("s-1");
    await user.click(getByRole("button", { name: /new session/i }));
    await user.type(
      await screen.findByRole("textbox", { name: /name \(optional\)/i }),
      "  Typed name  ",
    );
    await user.click(getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(body).toEqual({ name: "Typed name" }));
  });

  it("surfaces a create error as a notification", async () => {
    server.use(
      http.post("/api/sessions", () =>
        HttpResponse.json({ status: 500, detail: "Storage full" }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    const { findByText, getByRole } = renderWithProviders(<SessionsView />);
    await findByText("s-1");
    await user.click(getByRole("button", { name: /new session/i }));
    await user.click(await screen.findByRole("button", { name: /^create$/i }));
    expect(await screen.findByText("Storage full", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("shows the session name with the id beneath it", async () => {
    server.use(
      http.get("/api/sessions", () => HttpResponse.json([{ ...session, name: "My study" }])),
    );
    const { findByText } = renderWithProviders(<SessionsView />);
    expect(await findByText("My study")).toBeInTheDocument();
    expect(await findByText("s-1")).toBeInTheDocument();
  });

  it("renames a session via the modal and refreshes", async () => {
    let body: unknown = null;
    let renamed = false;
    server.use(
      http.patch("/api/sessions/:id", async ({ request }) => {
        body = await request.json();
        renamed = true;
        return HttpResponse.json({
          sessionId: "s-1",
          name: "New name",
          createdAt: "2026-05-28T10:00:00Z",
          files: [],
        });
      }),
      http.get("/api/sessions", () =>
        HttpResponse.json([renamed ? { ...session, name: "New name" } : session]),
      ),
    );
    const user = userEvent.setup();
    const { findByText, getByRole } = renderWithProviders(<SessionsView />);
    await findByText("s-1");
    await user.click(getByRole("button", { name: /^rename$/i }));
    const input = await screen.findByRole("textbox", { name: /^name$/i });
    await user.clear(input);
    await user.type(input, "New name");
    await user.click(getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(body).toEqual({ name: "New name" }));
    // "New name" renders in both the success toast and the refreshed card.
    expect((await screen.findAllByText("New name")).length).toBeGreaterThanOrEqual(2);
  });

  it("lists sessions newest-first regardless of server order", async () => {
    server.use(
      http.get("/api/sessions", () =>
        HttpResponse.json([
          { sessionId: "s-old", createdAt: "2026-01-01T00:00:00Z", fileCount: 0 },
          { sessionId: "s-new", createdAt: "2026-06-01T00:00:00Z", fileCount: 0 },
        ]),
      ),
    );
    renderWithProviders(<SessionsView />);
    await screen.findByText("s-old");
    const ids = screen.getAllByText(/^s-(old|new)$/);
    expect(ids[0]).toHaveTextContent("s-new");
    expect(ids[1]).toHaveTextContent("s-old");
  });

  it("renders the staged files table with size and upload time", async () => {
    const user = userEvent.setup();
    const { findByText, findByRole } = renderWithProviders(<SessionsView />);
    await findByText("s-1");
    // The files table is collapsed by default; expand it via the "N file(s)" badge.
    await user.click(await findByRole("button", { name: /toggle file list/i }));

    // The default session summary carries two staged files (ae.xpt, dm.xpt).
    // Assert on table cells so the NewRunView file pickers (which also list the
    // names) do not collide with the lookup.
    expect(await findByRole("cell", { name: "dm.xpt" })).toBeInTheDocument();
    expect(await findByRole("cell", { name: "ae.xpt" })).toBeInTheDocument();
    // Size is formatted (2048 → 2.00 KiB) and the upload time is shown verbatim.
    expect(await findByRole("cell", { name: "2.00 KiB" })).toBeInTheDocument();
    expect(await findByRole("cell", { name: "2026-05-28T10:01:00Z" })).toBeInTheDocument();
  });

  it("uploads multiple files one at a time and continues past a per-file 409", async () => {
    const seen: string[] = [];
    const staged: SessionFileT[] = [];
    server.use(
      http.post("/api/sessions/:id/files", ({ request }) => {
        const name = new URL(request.url).searchParams.get("filename") ?? "";
        seen.push(name);
        if (name === "dup.xpt") {
          return HttpResponse.json(
            { status: 409, detail: "Filename already present" },
            { status: 409 },
          );
        }
        staged.push({ filename: name, sizeBytes: 1, uploadedAt: "2026-05-28T10:00:00Z" });
        const ok: FileUploadResponseT = { sessionId: "s-1", filename: name, size: 1 };
        return HttpResponse.json(ok, { status: 201 });
      }),
      http.get("/api/sessions", () =>
        HttpResponse.json([{ ...session, fileCount: staged.length, files: staged }]),
      ),
    );
    const user = userEvent.setup();
    const { findByText, findByRole, container } = renderWithProviders(<SessionsView />);
    await findByText("s-1");

    const files = [
      new File(["a"], "dm.xpt"),
      new File(["b"], "dup.xpt"),
      new File(["c"], "ae.xpt"),
    ];
    await user.upload(dropzoneInput(container), files);

    // All three were attempted (the 409 did not abort the batch)...
    await waitFor(() => expect(seen).toEqual(["dm.xpt", "dup.xpt", "ae.xpt"]));
    // ...the 409 surfaced as a notification...
    expect(
      await screen.findByText("Duplicate file: dup.xpt", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    // ...and the two accepted names appear in the refreshed session file table
    // (the table is collapsed by default, so expand it first).
    await user.click(await findByRole("button", { name: /toggle file list/i }));
    expect(await findByRole("cell", { name: "dm.xpt" })).toBeInTheDocument();
    expect(await findByRole("cell", { name: "ae.xpt" })).toBeInTheDocument();
  });

  it("fetches a file by URL and shows it in the file table", async () => {
    const staged: SessionFileT[] = [];
    server.use(
      http.post("/api/sessions/:id/files/from-url", async ({ request }) => {
        const { url } = (await request.json()) as { url: string; filename?: string };
        const name = url.substring(url.lastIndexOf("/") + 1);
        staged.push({ filename: name, sizeBytes: 42, uploadedAt: "2026-05-28T10:00:00Z" });
        const ok: FileUploadResponseT = { sessionId: "s-1", filename: name, size: 42 };
        return HttpResponse.json(ok, { status: 201 });
      }),
      http.get("/api/sessions", () =>
        HttpResponse.json([{ ...session, fileCount: staged.length, files: staged }]),
      ),
    );
    const user = userEvent.setup();
    const { findByText, findByRole, getByRole } = renderWithProviders(<SessionsView />);
    await findByText("s-1");

    await user.type(
      getByRole("textbox", { name: /add a file by URL/i }),
      "https://example.com/data/lb.xpt",
    );
    await user.click(getByRole("button", { name: /fetch/i }));

    // Expand the (collapsed-by-default) file list, then assert the new file row.
    await user.click(await findByRole("button", { name: /toggle file list/i }));
    expect(await findByRole("cell", { name: "lb.xpt" })).toBeInTheDocument();
  });

  it("surfaces a URL-fetch error as a notification", async () => {
    server.use(
      http.post("/api/sessions/:id/files/from-url", () =>
        HttpResponse.json(
          { status: 400, detail: "Only http/https URLs are supported" },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    const { findByText, getByRole } = renderWithProviders(<SessionsView />);
    await findByText("s-1");

    await user.type(getByRole("textbox", { name: /add a file by URL/i }), "ftp://x/y.xpt");
    await user.click(getByRole("button", { name: /fetch/i }));

    expect(
      await screen.findByText("Only http/https URLs are supported", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  it("deletes a session", async () => {
    let deleted = false;
    server.use(
      http.delete("/api/sessions/:id", () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
      http.get("/api/sessions", () => HttpResponse.json(deleted ? [] : [session])),
    );
    const user = userEvent.setup();
    const { findByText, getByRole } = renderWithProviders(<SessionsView />);
    await findByText("s-1");
    await user.click(getByRole("button", { name: /^delete$/i }));
    expect(await findByText(/No sessions yet/i)).toBeInTheDocument();
  });

  it("surfaces a 409 in-flight delete with a clear message", async () => {
    server.use(
      http.delete("/api/sessions/:id", () =>
        HttpResponse.json({ status: 409, detail: "Cancel its runs first" }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    const { findByText, getByRole } = renderWithProviders(<SessionsView />);
    await findByText("s-1");
    await user.click(getByRole("button", { name: /^delete$/i }));
    expect(
      await screen.findByText("Session has in-flight runs", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    // The session is still listed (delete was rejected).
    expect(await findByText("s-1")).toBeInTheDocument();
  });

  it("deletes a single staged file and refreshes the table", async () => {
    const files: SessionFileT[] = [
      { filename: "ae.xpt", sizeBytes: 2048, uploadedAt: "2026-05-28T10:01:00Z" },
      { filename: "dm.xpt", sizeBytes: 1024, uploadedAt: "2026-05-28T10:00:30Z" },
    ];
    let deletedName: string | null = null;
    server.use(
      http.delete("/api/sessions/:id/files/:filename", ({ params }) => {
        deletedName = params.filename as string;
        return new HttpResponse(null, { status: 204 });
      }),
      http.get("/api/sessions", () => {
        const remaining = deletedName ? files.filter((f) => f.filename !== deletedName) : files;
        return HttpResponse.json([{ ...session, fileCount: remaining.length, files: remaining }]);
      }),
    );
    const user = userEvent.setup();
    const { findByText, findByRole, queryByRole } = renderWithProviders(<SessionsView />);
    await findByText("s-1");
    await user.click(await findByRole("button", { name: /toggle file list/i }));
    expect(await findByRole("cell", { name: "dm.xpt" })).toBeInTheDocument();

    await user.click(await findByRole("button", { name: "Delete dm.xpt" }));

    await waitFor(() => expect(deletedName).toBe("dm.xpt"));
    // The deleted row is gone; the surviving one remains.
    await waitFor(() => expect(queryByRole("cell", { name: "dm.xpt" })).not.toBeInTheDocument());
    expect(await findByRole("cell", { name: "ae.xpt" })).toBeInTheDocument();
  });

  it("deletes all staged files and refreshes the table", async () => {
    let cleared = false;
    server.use(
      http.delete("/api/sessions/:id/files", () => {
        cleared = true;
        return new HttpResponse(null, { status: 204 });
      }),
      http.get("/api/sessions", () =>
        HttpResponse.json([
          cleared
            ? { ...session, fileCount: 0, files: [] }
            : {
                ...session,
                fileCount: 1,
                files: [
                  { filename: "dm.xpt", sizeBytes: 1024, uploadedAt: "2026-05-28T10:00:30Z" },
                ],
              },
        ]),
      ),
    );
    const user = userEvent.setup();
    const { findByText, findByRole, queryByRole } = renderWithProviders(<SessionsView />);
    await findByText("s-1");
    await user.click(await findByRole("button", { name: /toggle file list/i }));
    expect(await findByRole("cell", { name: "dm.xpt" })).toBeInTheDocument();

    await user.click(await findByRole("button", { name: /delete all files/i }));

    await waitFor(() => expect(cleared).toBe(true));
    await waitFor(() => expect(queryByRole("cell", { name: "dm.xpt" })).not.toBeInTheDocument());
  });

  it("surfaces a 409 in-flight per-file delete with a clear message", async () => {
    server.use(
      http.delete("/api/sessions/:id/files/:filename", () =>
        HttpResponse.json({ status: 409, detail: "Cancel its runs first" }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    const { findByText, findByRole } = renderWithProviders(<SessionsView />);
    await findByText("s-1");
    await user.click(await findByRole("button", { name: /toggle file list/i }));
    await user.click(await findByRole("button", { name: "Delete dm.xpt" }));
    expect(
      await screen.findByText("Session has in-flight runs", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    // The file is still listed (delete was rejected).
    expect(await findByRole("cell", { name: "dm.xpt" })).toBeInTheDocument();
  });

  it("toggles an inline New Run form and forwards a started run", async () => {
    const onRunStarted = (id: string): void => {
      startedId = id;
    };
    let startedId = "";
    server.use(
      http.post("/api/sessions/:id/checks", () =>
        HttpResponse.json({ checkRunId: "c-7" }, { status: 201 }),
      ),
    );
    const user = userEvent.setup();
    const { findByText, findByRole, getByRole } = renderWithProviders(
      <SessionsView onRunStarted={onRunStarted} />,
    );
    await findByText("s-1");

    await user.click(getByRole("button", { name: /^new run$/i }));
    const form = await findByText("New check run");
    expect(form).toBeInTheDocument();

    // Awaited role queries: the form sits inside a Collapse, and role-based
    // queries see its content only once it has joined the accessibility tree.
    await user.type(
      await findByRole("combobox", { name: /Rules packages/ }),
      "cdisc-sdtmig-3-4{enter}",
    );
    await user.click(await findByRole("button", { name: /start check/i }));

    await waitFor(() => expect(startedId).toBe("c-7"));
  });

  it("surfaces a load error as a notification", async () => {
    server.use(
      http.get("/api/sessions", () =>
        HttpResponse.json({ status: 500, detail: "boom" }, { status: 500 }),
      ),
    );
    renderWithProviders(<SessionsView />);
    expect(await screen.findByText("boom", {}, { timeout: 3000 })).toBeInTheDocument();
  });
});
